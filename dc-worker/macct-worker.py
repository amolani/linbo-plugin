#!/usr/bin/env python3
"""
LINBO Docker - DC Worker (Machine Account + Host Provisioning)

This worker runs on the AD DC and consumes jobs from a Redis Stream:
- macct_repair: Machine account password repair (Phase 8)
- provision_host: Host provisioning via linuxmuster-import-devices (Phase 11)

Architecture:
- Connects to Redis Stream (linbo:jobs) via consumer group (dc-workers)
- Uses XREADGROUP for reliable job delivery
- macct: Executes repair_macct.py with --only-hosts flag
- provision: Delta/Merge devices.csv + linuxmuster-import-devices
- Reports status back to LINBO API
- XACK after successful processing
- Retry logic with exponential backoff
- Dead Letter Queue for permanently failed jobs

Requirements:
    pip install redis requests

Configuration via environment variables or config file:
    REDIS_HOST     - Redis server hostname
    REDIS_PORT     - Redis server port (default: 6379)
    REDIS_PASSWORD - Redis password (optional)
    API_URL        - LINBO API base URL
    API_KEY        - Internal API key for authentication
    CONSUMER_NAME  - Unique name for this consumer (default: hostname)
    LOG_DIR        - Directory for job logs (default: /var/log/macct)

Usage:
    python3 macct-worker.py [--config /path/to/config.conf]
"""

import os
import re
import sys
import json
import time
import fcntl
import socket
import signal
import logging
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple

try:
    import redis
    import requests
except ImportError:
    print("Missing required packages. Install with: pip install redis requests")
    sys.exit(1)


# =============================================================================
# Configuration
# =============================================================================

class Config:
    """Worker configuration from environment or file"""

    def __init__(self, config_file: Optional[str] = None):
        self.redis_host = os.getenv('REDIS_HOST', 'localhost')
        self.redis_port = int(os.getenv('REDIS_PORT', '6379'))
        self.redis_password = os.getenv('REDIS_PASSWORD', None)
        self.redis_db = int(os.getenv('REDIS_DB', '0'))

        self.api_url = os.getenv('API_URL', 'http://localhost:3000/api/v1')
        self.api_key = os.getenv('API_KEY', 'linbo-internal-secret')

        self.consumer_name = os.getenv('CONSUMER_NAME', socket.gethostname())
        self.log_dir = Path(os.getenv('LOG_DIR', '/var/log/macct'))

        self.stream_name = 'linbo:jobs'
        self.consumer_group = 'dc-workers'
        self.dlq_stream = 'linbo:jobs:dlq'

        self.max_retries = 3
        self.block_timeout = 5000  # ms
        self.batch_size = 10
        self.min_idle_time = 300000  # 5 minutes - for claiming stuck jobs

        self.repair_script = '/usr/share/linuxmuster/linbo/repair_macct.py'

        # Host provisioning config (Phase 11)
        self.school = os.getenv('SCHOOL', 'default-school')
        sophomorix_base = '/etc/linuxmuster/sophomorix/{school}'

        self.devices_csv_master = os.getenv('DEVICES_CSV_MASTER',
            f'{sophomorix_base}/devices.csv').replace('{school}', self.school)
        self.devices_csv_delta = os.getenv('DEVICES_CSV_DELTA',
            f'{sophomorix_base}/linbo-docker.devices.csv').replace('{school}', self.school)
        self.import_script = os.getenv('IMPORT_SCRIPT',
            '/usr/sbin/linuxmuster-import-devices')
        self.provision_lock_file = os.getenv('PROVISION_LOCK_FILE',
            '/var/lock/linbo-provision.lock')
        self.domain = os.getenv('LINBO_DOMAIN', 'linuxmuster.lan')
        self.dhcp_verify_file = os.getenv('DHCP_VERIFY_FILE',
            '').replace('{school}', self.school)
        self.samba_tool_auth = os.getenv('SAMBA_TOOL_AUTH', '')
        self.rev_dns_octets = int(os.getenv('REV_DNS_OCTETS', '3'))
        self.provision_batch_size = int(os.getenv('PROVISION_BATCH_SIZE', '50'))
        self.provision_debounce_sec = int(os.getenv('PROVISION_DEBOUNCE_SEC', '5'))

        if config_file:
            self._load_config_file(config_file)

        # Ensure log directory exists
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def _load_config_file(self, path: str):
        """Load configuration from file"""
        config_path = Path(path)
        if not config_path.exists():
            logging.warning(f"Config file not found: {path}")
            return

        with open(config_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip().lower()
                    value = value.strip().strip('"\'')

                    if key == 'redis_host':
                        self.redis_host = value
                    elif key == 'redis_port':
                        self.redis_port = int(value)
                    elif key == 'redis_password':
                        self.redis_password = value if value else None
                    elif key == 'api_url':
                        self.api_url = value
                    elif key == 'api_key':
                        self.api_key = value
                    elif key == 'consumer_name':
                        self.consumer_name = value
                    elif key == 'log_dir':
                        self.log_dir = Path(value)
                    elif key == 'repair_script':
                        self.repair_script = value
                    # Provisioning config
                    elif key == 'school':
                        self.school = value
                    elif key == 'devices_csv_master':
                        self.devices_csv_master = value.replace('{school}', self.school)
                    elif key == 'devices_csv_delta':
                        self.devices_csv_delta = value.replace('{school}', self.school)
                    elif key == 'import_script':
                        self.import_script = value
                    elif key == 'provision_lock_file':
                        self.provision_lock_file = value
                    elif key == 'linbo_domain':
                        self.domain = value
                    elif key == 'dhcp_verify_file':
                        self.dhcp_verify_file = value.replace('{school}', self.school)
                    elif key == 'samba_tool_auth':
                        self.samba_tool_auth = value
                    elif key == 'rev_dns_octets':
                        self.rev_dns_octets = int(value)
                    elif key == 'provision_batch_size':
                        self.provision_batch_size = int(value)
                    elif key == 'provision_debounce_sec':
                        self.provision_debounce_sec = int(value)


# =============================================================================
# Logging
# =============================================================================

def setup_logging(log_dir: Path):
    """Configure logging to console and file"""
    log_file = log_dir / 'macct-worker.log'

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(log_file)
        ]
    )
    return logging.getLogger(__name__)


# =============================================================================
# Redis Client
# =============================================================================

class RedisClient:
    """Redis client wrapper with connection handling"""

    def __init__(self, config: Config):
        self.config = config
        self.client: Optional[redis.Redis] = None

    def connect(self) -> redis.Redis:
        """Connect to Redis server"""
        self.client = redis.Redis(
            host=self.config.redis_host,
            port=self.config.redis_port,
            password=self.config.redis_password,
            db=self.config.redis_db,
            decode_responses=True,
            socket_timeout=30,
            socket_connect_timeout=10,
            retry_on_timeout=True
        )
        # Test connection
        self.client.ping()
        return self.client

    def ensure_consumer_group(self):
        """Ensure consumer group exists"""
        try:
            self.client.xgroup_create(
                self.config.stream_name,
                self.config.consumer_group,
                id='$',
                mkstream=True
            )
            logging.info(f"Created consumer group: {self.config.consumer_group}")
        except redis.ResponseError as e:
            if 'BUSYGROUP' in str(e):
                logging.debug(f"Consumer group already exists: {self.config.consumer_group}")
            else:
                raise

    def read_jobs(self) -> List[Tuple[str, str, Dict[str, str]]]:
        """Read jobs from stream using consumer group"""
        entries = self.client.xreadgroup(
            groupname=self.config.consumer_group,
            consumername=self.config.consumer_name,
            streams={self.config.stream_name: '>'},
            count=self.config.batch_size,
            block=self.config.block_timeout
        )

        jobs = []
        if entries:
            for stream_name, messages in entries:
                for msg_id, fields in messages:
                    jobs.append((stream_name, msg_id, fields))
        return jobs

    def drain_jobs(self, count: int) -> List[Tuple[str, Dict[str, str]]]:
        """Non-blocking drain: claim messages from stream (remain in PEL)"""
        entries = self.client.xreadgroup(
            groupname=self.config.consumer_group,
            consumername=self.config.consumer_name,
            streams={self.config.stream_name: '>'},
            count=count,
            block=100  # 100ms — block=0 means "forever" in redis-py!
        )

        jobs = []
        if entries:
            for stream_name, messages in entries:
                for msg_id, fields in messages:
                    jobs.append((msg_id, fields))
        return jobs

    def ack_job(self, msg_id: str):
        """Acknowledge a processed job"""
        self.client.xack(
            self.config.stream_name,
            self.config.consumer_group,
            msg_id
        )

    def ack_batch(self, msg_ids: List[str]):
        """Acknowledge multiple messages at once"""
        if msg_ids:
            self.client.xack(
                self.config.stream_name,
                self.config.consumer_group,
                *msg_ids
            )

    def move_to_dlq(self, fields: Dict[str, str], error: str):
        """Move failed job to Dead Letter Queue"""
        dlq_fields = {
            **fields,
            'last_error': error,
            'failed_at': datetime.now().isoformat()
        }
        self.client.xadd(self.config.dlq_stream, dlq_fields)

    def claim_stuck_jobs(self) -> List[Tuple[str, Dict[str, str]]]:
        """Claim jobs stuck in other consumers"""
        try:
            result = self.client.xautoclaim(
                self.config.stream_name,
                self.config.consumer_group,
                self.config.consumer_name,
                self.config.min_idle_time,
                start_id='0-0',
                count=self.config.batch_size
            )
            # Result format: [next_start_id, [[id, {fields}], ...], [deleted_ids]]
            if result and len(result) > 1:
                return [(msg[0], msg[1]) for msg in result[1]]
        except Exception as e:
            logging.warning(f"Error claiming stuck jobs: {e}")
        return []


# =============================================================================
# API Client
# =============================================================================

class APIClient:
    """Client for LINBO API communication"""

    def __init__(self, config: Config):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            'X-Internal-Key': config.api_key,
            'Content-Type': 'application/json'
        })

    def update_status(self, operation_id: str, status: str,
                      result: Optional[Dict] = None,
                      error: Optional[str] = None,
                      attempt: Optional[int] = None) -> bool:
        """Update operation status via API"""
        url = f"{self.config.api_url}/internal/operations/{operation_id}/status"

        payload = {'status': status}
        if result is not None:
            payload['result'] = result
        if error is not None:
            payload['error'] = error
        if attempt is not None:
            payload['attempt'] = attempt

        try:
            response = self.session.patch(url, json=payload, timeout=10)
            if response.status_code == 200:
                logging.debug(f"Updated status for {operation_id}: {status}")
                return True
            else:
                logging.error(f"API error {response.status_code}: {response.text}")
                return False
        except requests.RequestException as e:
            logging.error(f"API request failed: {e}")
            return False

    def get_operation(self, operation_id: str) -> Optional[Dict]:
        """Fetch full operation details (including options) from API"""
        url = f"{self.config.api_url}/internal/operations/{operation_id}"

        try:
            response = self.session.get(url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                return data.get('data', data)
            else:
                logging.error(f"API error fetching operation {operation_id}: {response.status_code}")
                return None
        except requests.RequestException as e:
            logging.error(f"API request failed: {e}")
            return None

    def retry_job(self, operation_id: str) -> bool:
        """Request job retry via API"""
        url = f"{self.config.api_url}/internal/operations/{operation_id}/retry"

        try:
            response = self.session.post(url, timeout=10)
            return response.status_code == 200
        except requests.RequestException as e:
            logging.error(f"Retry request failed: {e}")
            return False


# =============================================================================
# Provision Processor (Phase 11)
# =============================================================================

class ProvisionProcessor:
    """Processes host provisioning jobs via delta/merge + linuxmuster-import-devices"""

    DELTA_HEADER = '# managed-by: linbo-docker — DO NOT EDIT MANUALLY\n'

    def __init__(self, config: Config, api: APIClient, redis_client: 'RedisClient'):
        self.config = config
        self.api = api
        self.redis_client = redis_client
        self._lock_fd = None
        self._deleted_hosts = set()  # Job-scope state for merge

    def process(self, trigger_msg_id: str, trigger_fields: Dict[str, str]) -> bool:
        """
        Process a provision_host job with batching.

        1. Acquire lock
        2. Fetch + validate trigger job
        3. Debounce (wait for more jobs)
        4. Drain pending provision jobs for same school
        5. Apply delta for all jobs
        6. Merge master + delta
        7. Conflict check on merged view
        8. Write files + run import (or dry-run)
        9. Verify per host
        10. Mark operations completed/failed
        11. ACK all messages
        12. Release lock

        Returns True to ACK the trigger message.
        """
        operation_id = trigger_fields.get('operation_id')
        school = trigger_fields.get('school', 'default-school')

        logging.info(f"[Provision] Starting batch for school={school}, trigger={operation_id}")

        # Acquire file lock
        if not self._acquire_lock():
            logging.error(f"[Provision] Could not acquire lock, will retry")
            self.api.update_status(operation_id, 'failed',
                                   error='Could not acquire provision lock')
            return True

        try:
            return self._process_batch(trigger_msg_id, trigger_fields, school)
        except Exception as e:
            logging.error(f"[Provision] Batch failed: {e}")
            self.api.update_status(operation_id, 'failed', error=str(e))
            return True
        finally:
            self._release_lock()
            self._deleted_hosts.clear()

    def _process_batch(self, trigger_msg_id: str, trigger_fields: Dict[str, str],
                       school: str) -> bool:
        """Core batch processing logic"""
        # Collect all jobs: trigger + drained
        all_jobs = []  # [(msg_id, operation_id, options), ...]
        all_msg_ids = [trigger_msg_id]

        # 1. Fetch trigger job details
        trigger_op_id = trigger_fields.get('operation_id')
        trigger_op = self.api.get_operation(trigger_op_id)
        if not trigger_op:
            logging.error(f"[Provision] Could not fetch operation {trigger_op_id}")
            return True

        trigger_options = trigger_op.get('options', {})
        try:
            self._validate_hostname(trigger_options.get('hostname', ''))
        except ValueError as e:
            self.api.update_status(trigger_op_id, 'failed', error=str(e))
            return True

        all_jobs.append((trigger_msg_id, trigger_op_id, trigger_options))

        # 2. Debounce — wait for more jobs to arrive
        if self.config.provision_debounce_sec > 0:
            logging.info(f"[Provision] Debounce: waiting {self.config.provision_debounce_sec}s...")
            time.sleep(self.config.provision_debounce_sec)

        # 3. Drain additional pending provision jobs
        drained = self.redis_client.drain_jobs(self.config.provision_batch_size)
        deferred_msgs = []  # non-provision or other school

        for msg_id, fields in drained:
            if (fields.get('type') == 'provision_host' and
                    fields.get('school', 'default-school') == school):
                op_id = fields.get('operation_id')
                op = self.api.get_operation(op_id)
                if not op:
                    logging.warning(f"[Provision] Could not fetch operation {op_id}, skipping")
                    self.redis_client.ack_job(msg_id)
                    continue

                options = op.get('options', {})
                try:
                    self._validate_hostname(options.get('hostname', ''))
                except ValueError as e:
                    self.api.update_status(op_id, 'failed', error=str(e))
                    self.redis_client.ack_job(msg_id)
                    continue

                all_jobs.append((msg_id, op_id, options))
                all_msg_ids.append(msg_id)
            else:
                deferred_msgs.append((msg_id, fields))

        logging.info(f"[Provision] Batch: {len(all_jobs)} provision jobs, "
                     f"{len(deferred_msgs)} deferred")

        # 4. Mark all as running
        for _, op_id, _ in all_jobs:
            self.api.update_status(op_id, 'running')

        # 5. Read existing delta file
        delta_lines = self._read_delta()

        # 6. Apply delta for each job
        failed_jobs = []  # (index, error)
        for i, (msg_id, op_id, options) in enumerate(all_jobs):
            action = options.get('action', 'create')
            try:
                delta_lines = self._apply_delta(delta_lines, action, options)
            except Exception as e:
                logging.error(f"[Provision] Delta apply failed for {options.get('hostname')}: {e}")
                self.api.update_status(op_id, 'failed', error=f'Delta apply error: {e}')
                failed_jobs.append(i)

        # Remove failed jobs from batch
        valid_jobs = [j for i, j in enumerate(all_jobs) if i not in failed_jobs]
        valid_msg_ids = [j[0] for j in valid_jobs]

        if not valid_jobs:
            logging.warning("[Provision] No valid jobs in batch, aborting")
            # ACK failed msg_ids
            for i in failed_jobs:
                self.redis_client.ack_job(all_jobs[i][0])
            self._process_deferred(deferred_msgs)
            return True

        # 7. Read master + merge
        master_lines = self._read_master()
        merged_lines = self._merge(master_lines, delta_lines)

        # 8. Conflict check on merged view
        for i, (msg_id, op_id, options) in enumerate(valid_jobs):
            action = options.get('action', 'create')
            conflict = self._check_conflicts(action, options, merged_lines)
            if conflict:
                logging.error(f"[Provision] Conflict for {options.get('hostname')}: {conflict}")
                self.api.update_status(op_id, 'failed', error=f'Conflict: {conflict}')
                failed_jobs.append(all_jobs.index((msg_id, op_id, options)))

        # Re-filter valid jobs after conflict check
        valid_jobs_final = [(m, o, opts) for m, o, opts in valid_jobs
                           if all_jobs.index((m, o, opts)) not in failed_jobs]

        if not valid_jobs_final:
            logging.warning("[Provision] All jobs failed conflict check")
            self.redis_client.ack_batch(all_msg_ids)
            self._process_deferred(deferred_msgs)
            return True

        # 9. Check dry-run (from first job's options — all should agree)
        dry_run = valid_jobs_final[0][2].get('dryRun', False)

        merge_stats = {
            'total_master_lines': len([l for l in master_lines if l.strip() and not l.startswith('#')]),
            'total_delta_lines': len([l for l in delta_lines if l.strip() and not l.startswith('#')]),
            'total_merged_lines': len([l for l in merged_lines if l.strip() and not l.startswith('#')]),
            'deleted_hosts': list(self._deleted_hosts),
            'batch_size': len(valid_jobs_final),
        }

        if dry_run:
            logging.info(f"[Provision] DRY-RUN: would write merged devices.csv "
                         f"({merge_stats['total_merged_lines']} lines)")
            logging.info(f"[Provision] DRY-RUN: would run {self.config.import_script}")

            for _, op_id, _ in valid_jobs_final:
                self.api.update_status(op_id, 'completed',
                                       result={'dryRun': True, 'mergeStats': merge_stats})

            self.redis_client.ack_batch(all_msg_ids)
            self._process_deferred(deferred_msgs)
            return True

        # 10. Write delta file
        self._write_delta(delta_lines)

        # 11. Write merged → devices.csv.tmp → atomic rename
        master_path = Path(self.config.devices_csv_master)
        tmp_path = master_path.with_suffix('.csv.tmp')
        bak_path = master_path.with_suffix('.csv.bak')

        try:
            # Write tmp
            with open(tmp_path, 'w') as f:
                for line in merged_lines:
                    f.write(line if line.endswith('\n') else line + '\n')

            # Backup
            if master_path.exists():
                import shutil
                shutil.copy2(str(master_path), str(bak_path))

            # Atomic rename
            os.rename(str(tmp_path), str(master_path))
            logging.info(f"[Provision] Wrote merged devices.csv ({len(merged_lines)} lines)")
        except Exception as e:
            logging.error(f"[Provision] Failed to write devices.csv: {e}")
            for _, op_id, _ in valid_jobs_final:
                self.api.update_status(op_id, 'failed', error=f'File write error: {e}')
            self.redis_client.ack_batch(all_msg_ids)
            self._process_deferred(deferred_msgs)
            return True

        # 12. Execute linuxmuster-import-devices (ONCE for entire batch)
        import_result = self._run_import_script()

        if not import_result['success']:
            logging.error(f"[Provision] import-devices failed: {import_result['error']}")
            for _, op_id, _ in valid_jobs_final:
                self.api.update_status(op_id, 'failed',
                                       error=f'import-devices failed: {import_result["error"]}')
            self.redis_client.ack_batch(all_msg_ids)
            self._process_deferred(deferred_msgs)
            return True

        # 13. Verify per host and mark completed/failed
        domain = self._get_domain()
        verify_ok = 0
        verify_fail = 0
        for _, op_id, options in valid_jobs_final:
            hostname = options.get('hostname', '')
            action = options.get('action', 'create')

            verify = self._verify_results(hostname, action, domain, options)

            if action == 'delete':
                # For deletes, run explicit cleanup if needed
                if verify.get('ad_object_exists') or verify.get('dns_a_exists'):
                    self._cleanup_deleted_host(hostname, domain, options)
                    verify = self._verify_results(hostname, action, domain, options)

            result_data = {
                'verify': verify,
                'mergeStats': merge_stats,
                'importOutput': import_result.get('stdout', '')[:500],
            }

            # Determine success: AD + DNS-A are required for create/update
            if action == 'delete':
                success = not verify.get('ad_object_exists', False) and \
                          not verify.get('dns_a_exists', False)
            else:
                success = verify.get('ad_object_exists', False) and \
                          verify.get('dns_a_exists', False)

            if success:
                self.api.update_status(op_id, 'completed', result=result_data)
                verify_ok += 1
            else:
                self.api.update_status(op_id, 'failed',
                                       error=f'Verify failed: {json.dumps(verify)}',
                                       result=result_data)
                verify_fail += 1

        # 14. ACK all messages
        self.redis_client.ack_batch(all_msg_ids)
        # ACK failed-during-delta msg_ids too
        for i in failed_jobs:
            if i < len(all_jobs):
                self.redis_client.ack_job(all_jobs[i][0])

        # 15. Process deferred messages
        self._process_deferred(deferred_msgs)

        logging.info(f"[Provision] Batch complete: "
                     f"{verify_ok} verified OK, {verify_fail} failed verify")
        return True

    def _process_deferred(self, deferred_msgs: List[Tuple[str, Dict[str, str]]]):
        """Process deferred (non-provision) messages after batch"""
        for msg_id, fields in deferred_msgs:
            job_type = fields.get('type')
            if job_type == 'macct_repair':
                # Hand off to macct processing (parent processor handles this)
                logging.info(f"[Provision] Deferred macct job {msg_id} — will be re-read")
                # Don't ACK — leave in PEL for next read cycle
            else:
                logging.warning(f"[Provision] Unknown deferred job type: {job_type}")
                self.redis_client.ack_job(msg_id)

    # -------------------------------------------------------------------------
    # Delta / Merge / Conflict
    # -------------------------------------------------------------------------

    def _read_delta(self) -> List[str]:
        """Read existing delta file, return lines"""
        path = Path(self.config.devices_csv_delta)
        if not path.exists():
            return [self.DELTA_HEADER]
        try:
            with open(path) as f:
                return f.readlines()
        except Exception as e:
            logging.warning(f"[Provision] Could not read delta: {e}")
            return [self.DELTA_HEADER]

    def _write_delta(self, lines: List[str]):
        """Write delta file to disk"""
        path = Path(self.config.devices_csv_delta)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'w') as f:
            for line in lines:
                f.write(line if line.endswith('\n') else line + '\n')

    def _read_master(self) -> List[str]:
        """Read master devices.csv"""
        path = Path(self.config.devices_csv_master)
        if not path.exists():
            logging.warning(f"[Provision] Master file not found: {path}")
            return []
        with open(path) as f:
            return f.readlines()

    def _apply_delta(self, delta_lines: List[str], action: str,
                     options: Dict[str, Any]) -> List[str]:
        """Modify delta file in-memory for a single host action"""
        hostname = options.get('hostname', '')
        old_hostname = options.get('oldHostname')

        if action == 'delete':
            # Remove from delta + mark for merge removal
            delta_lines = [l for l in delta_lines
                          if not self._line_matches_host(l, hostname)]
            self._deleted_hosts.add(hostname.lower())
            return delta_lines

        if action == 'update' and old_hostname and old_hostname.lower() != hostname.lower():
            # Rename: remove old, add new, mark old for deletion in master
            delta_lines = [l for l in delta_lines
                          if not self._line_matches_host(l, old_hostname)]
            self._deleted_hosts.add(old_hostname.lower())

        # Create or update: format new CSV line
        csv_line = self._format_csv_line(options)

        # Check if already in delta (update case)
        found = False
        new_lines = []
        for line in delta_lines:
            if self._line_matches_host(line, hostname):
                new_lines.append(csv_line + '\n')
                found = True
            else:
                new_lines.append(line)

        if not found:
            new_lines.append(csv_line + '\n')

        return new_lines

    def _line_matches_host(self, line: str, hostname: str) -> bool:
        """Check if a CSV line matches a hostname (column 1)"""
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            return False
        parts = stripped.split(';')
        return len(parts) >= 2 and parts[1].strip().lower() == hostname.lower()

    def _format_csv_line(self, options: Dict[str, Any]) -> str:
        """Format full 15-column CSV line compatible with sophomorix-device.

        Column layout (from sophomorix-device Perl parser):
          0: room, 1: hostname, 2: device_group (config), 3: MAC, 4: IP,
          5: ms_office_key, 6: ms_windows_key, 7: unused,
          8: sophomorix_role, 9: unused_2, 10: pxe_flag,
          11: option, 12: field_13, 13: field_14, 14: sophomorix_comment
        """
        pxe = str(options.get('pxeFlag', 1))
        role = options.get('role', '')
        return ';'.join([
            options.get('csvCol0', ''),              # 0: room
            options.get('hostname', ''),              # 1: hostname
            options.get('configName', '') or 'nopxe', # 2: device group
            (options.get('mac', '') or '').upper(),   # 3: MAC
            options.get('ip', '') or 'DHCP',          # 4: IP
            '',                                       # 5: ms_office_key
            '',                                       # 6: ms_windows_key
            '',                                       # 7: unused
            role,                                     # 8: sophomorix_role
            '',                                       # 9: unused_2
            pxe,                                      # 10: pxe_flag (REQUIRED)
            '',                                       # 11: option
            '',                                       # 12: field_13
            '',                                       # 13: field_14
            '',                                       # 14: sophomorix_comment
        ])

    # Columns managed by linbo-docker (patched from delta into master)
    MANAGED_COLS = {0, 1, 2, 3, 4, 8, 10}  # room, host, config, mac, ip, role, pxe

    def _merge(self, master_lines: List[str], delta_lines: List[str]) -> List[str]:
        """
        Patch-Merge: Master + Delta
        - Delta patches Master entries (MANAGED_COLS from delta, rest from master)
        - Master entries without Delta match stay unchanged
        - Deleted hostnames (in self._deleted_hosts) are removed
        - New delta entries (not in master) appended, padded to master col count
        """
        delta_map = {}  # hostname -> full column list
        for line in delta_lines:
            stripped = line.strip()
            if not stripped or stripped.startswith('#'):
                continue
            parts = stripped.split(';')
            if len(parts) >= 2:
                delta_map[parts[1].strip().lower()] = parts

        merged = []
        seen = set()

        # Determine master column count for padding
        master_cols = 5
        for line in master_lines:
            stripped = line.strip()
            if stripped and not stripped.startswith('#'):
                cols = len(stripped.split(';'))
                if cols > master_cols:
                    master_cols = cols

        for line in master_lines:
            stripped = line.strip()
            if not stripped or stripped.startswith('#'):
                merged.append(line)
                continue
            parts = stripped.split(';')
            if len(parts) < 2:
                merged.append(line)
                continue
            hostname = parts[1].strip().lower()
            seen.add(hostname)

            if hostname in self._deleted_hosts:
                continue  # Remove deleted hosts
            elif hostname in delta_map:
                # PATCH: managed cols from delta, rest preserved from master
                delta_parts = delta_map[hostname]
                patched = list(parts)
                # Extend patched to at least delta length
                while len(patched) < len(delta_parts):
                    patched.append('')
                for i in self.MANAGED_COLS:
                    if i < len(delta_parts):
                        patched[i] = delta_parts[i]
                merged.append(';'.join(patched) + '\n')
            else:
                merged.append(line)

        # Append new delta entries not in master, padded to master col count
        for hostname, parts in delta_map.items():
            if hostname not in seen and hostname not in self._deleted_hosts:
                padded = list(parts) + [''] * max(0, master_cols - len(parts))
                merged.append(';'.join(padded) + '\n')

        return merged

    def _check_conflicts(self, action: str, options: Dict[str, Any],
                         merged_lines: List[str]) -> Optional[str]:
        """Check for conflicts in merged view. Returns error string or None."""
        if action == 'delete':
            return None

        hostname = options.get('hostname', '').lower()
        mac = (options.get('mac', '') or '').upper()
        ip = options.get('ip', '')

        for line in merged_lines:
            stripped = line.strip()
            if not stripped or stripped.startswith('#'):
                continue
            parts = stripped.split(';')
            if len(parts) < 5:
                continue

            line_hostname = parts[1].strip().lower()
            line_mac = parts[3].strip().upper()
            line_ip = parts[4].strip()

            # Skip self
            if line_hostname == hostname:
                continue

            if mac and line_mac == mac:
                return f"Duplicate MAC {mac} with host {parts[1].strip()}"
            if ip and ip != 'DHCP' and line_ip == ip and line_ip != 'DHCP':
                return f"Duplicate IP {ip} with host {parts[1].strip()}"

        return None

    # -------------------------------------------------------------------------
    # Import Script
    # -------------------------------------------------------------------------

    # Patterns in import-devices output that indicate sophomorix-device failure.
    # The upstream script ignores subProc() return values, so exit code 0 does
    # NOT guarantee success.  We must scan stdout/stderr for known errors.
    _ERROR_PATTERNS = [
        'ERROR:',                          # sophomorix-device validation errors
        'errors detected',                 # linuxmuster-import-devices own message
        'syntax check failed',             # future-proof
    ]

    def _run_import_script(self) -> Dict[str, Any]:
        """Execute linuxmuster-import-devices"""
        script = self.config.import_script

        if not Path(script).exists():
            return {'success': False, 'error': f'Script not found: {script}'}

        logging.info(f"[Provision] Running {script}")

        try:
            result = subprocess.run(
                [script],
                capture_output=True,
                text=True,
                timeout=600  # 10 minute timeout
            )

            combined = (result.stdout or '') + (result.stderr or '')

            if result.returncode != 0:
                return {
                    'success': False,
                    'error': result.stderr or f'Exit code {result.returncode}',
                    'stdout': result.stdout,
                }

            # Workaround for upstream bug: linuxmuster-import-devices ignores
            # the return value of subProc('sophomorix-device --sync') and exits
            # with code 0 even when sophomorix-device fails.  Detect this by
            # scanning the combined output for error patterns.
            for pattern in self._ERROR_PATTERNS:
                if pattern in combined:
                    logging.error(f"[Provision] import-devices returned 0 but "
                                  f"output contains '{pattern}'")
                    return {
                        'success': False,
                        'error': f'import-devices output contains error: {pattern}',
                        'stdout': result.stdout,
                        'stderr': result.stderr,
                    }

            logging.info(f"[Provision] import-devices completed successfully")
            return {
                'success': True,
                'stdout': result.stdout,
                'stderr': result.stderr,
            }
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Script timed out after 10 minutes'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # -------------------------------------------------------------------------
    # Verify
    # -------------------------------------------------------------------------

    def _verify_results(self, hostname: str, action: str, domain: str,
                        options: Optional[Dict] = None) -> Dict[str, Any]:
        """Verify provisioning results after import-devices"""
        fqdn = f"{hostname}.{domain}"
        results = {
            'ad_object_exists': self._check_ad(hostname),
            'dns_a_exists': self._check_dns(fqdn),
            'dhcp_configured': self._check_dhcp(hostname),
        }

        ip = (options or {}).get('ip', '')
        if ip and ip != 'DHCP':
            results['dns_ptr_exists'] = self._check_ptr(ip, fqdn)
        else:
            results['dns_ptr_exists'] = None

        if action == 'delete':
            results['expected_absent'] = True

        return results

    def _check_ad(self, hostname: str) -> bool:
        """Check if AD computer object exists"""
        try:
            result = subprocess.run(
                ['samba-tool', 'computer', 'show', hostname],
                capture_output=True, text=True, timeout=30
            )
            return result.returncode == 0
        except Exception:
            return False

    def _check_dns(self, fqdn: str, retries: int = 5, delay: int = 2) -> bool:
        """Check DNS A record with retries"""
        for i in range(retries):
            try:
                result = subprocess.run(
                    ['host', fqdn],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode == 0:
                    return True
            except Exception:
                pass
            if i < retries - 1:
                time.sleep(delay)
        return False

    def _check_ptr(self, ip: str, expected_fqdn: str) -> Optional[bool]:
        """Check reverse DNS (best-effort)"""
        try:
            result = subprocess.run(
                ['host', ip],
                capture_output=True, text=True, timeout=10
            )
            return expected_fqdn in result.stdout
        except Exception:
            return None

    def _check_dhcp(self, hostname: str) -> Optional[bool]:
        """Check DHCP config for host entry"""
        dhcp_conf = self.config.dhcp_verify_file
        if not dhcp_conf:
            logging.info(f"[Verify] DHCP verify skipped (DHCP_VERIFY_FILE not set)")
            return None
        try:
            with open(dhcp_conf) as f:
                return f'host {hostname} ' in f.read()
        except FileNotFoundError:
            logging.warning(f"[Verify] DHCP file not found: {dhcp_conf}")
            return None
        except Exception:
            return False

    def _get_domain(self) -> str:
        """Get DNS domain from config, with optional auto-detect from Samba"""
        if self.config.domain and self.config.domain != 'auto':
            return self.config.domain
        try:
            result = subprocess.run(
                ['samba-tool', 'domain', 'info', '127.0.0.1'],
                capture_output=True, text=True, timeout=10
            )
            for line in result.stdout.splitlines():
                stripped = line.strip()
                if stripped.startswith('Realm:') or stripped.startswith('Domain name:'):
                    value = stripped.split(':', 1)[1].strip().lower()
                    if '.' in value:
                        return value
        except Exception:
            pass
        return self.config.domain or 'linuxmuster.lan'

    # -------------------------------------------------------------------------
    # Cleanup (for delete actions)
    # -------------------------------------------------------------------------

    def _cleanup_deleted_host(self, hostname: str, domain: str,
                              options: Optional[Dict] = None):
        """Explicit cleanup if import-devices didn't remove AD/DNS"""
        fqdn = f"{hostname}.{domain}"
        ip = (options or {}).get('ip', '')
        auth_args = self._get_samba_auth_args()

        if not auth_args:
            logging.warning(f"[Provision] SAMBA_TOOL_AUTH not set — skipping cleanup for {hostname}")
            return

        # AD cleanup
        if self._check_ad(hostname):
            logging.info(f"[Provision] AD object still exists, deleting: {hostname}")
            subprocess.run(['samba-tool', 'computer', 'delete', hostname] + auth_args,
                           capture_output=True, timeout=30)

        # DNS A record cleanup
        if self._check_dns(fqdn, retries=1, delay=0):
            if ip and ip != 'DHCP':
                logging.info(f"[Provision] DNS A record still exists, deleting: {fqdn}")
                subprocess.run(['samba-tool', 'dns', 'delete', '127.0.0.1',
                                domain, hostname, 'A', ip] + auth_args,
                               capture_output=True, timeout=30)
            else:
                logging.warning(f"[Provision] DNS A exists but no IP known — manual cleanup needed")

        # PTR record cleanup (best-effort)
        if ip and ip != 'DHCP':
            reverse_zone = self._get_reverse_zone(ip)
            ptr_name = ip.split('.')[-1]
            try:
                subprocess.run(['samba-tool', 'dns', 'delete', '127.0.0.1',
                                reverse_zone, ptr_name, 'PTR', fqdn + '.'] + auth_args,
                               capture_output=True, timeout=30)
            except Exception:
                pass

    def _get_samba_auth_args(self) -> List[str]:
        """Return samba-tool auth args, or empty list if not configured"""
        auth = self.config.samba_tool_auth
        if not auth:
            return []
        return auth.split()

    def _get_reverse_zone(self, ip: str) -> str:
        """Convert IP to reverse DNS zone"""
        octets = ip.split('.')
        n = self.config.rev_dns_octets
        return '.'.join(reversed(octets[:n])) + '.in-addr.arpa'

    # -------------------------------------------------------------------------
    # Hostname Validation
    # -------------------------------------------------------------------------

    def _validate_hostname(self, hostname: str):
        """Validate hostname (NetBIOS 15-char limit)"""
        if not hostname:
            raise ValueError("Hostname is empty")
        if len(hostname) > 15:
            raise ValueError(f"Hostname '{hostname}' exceeds NetBIOS 15-char limit")
        if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9-]*$', hostname):
            raise ValueError(f"Invalid hostname format: '{hostname}'")

    # -------------------------------------------------------------------------
    # File Lock
    # -------------------------------------------------------------------------

    def _acquire_lock(self, timeout: int = 300) -> bool:
        """Acquire exclusive file lock"""
        lock_path = self.config.provision_lock_file
        Path(lock_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock_fd = open(lock_path, 'w')
        start = time.time()
        while time.time() - start < timeout:
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except IOError:
                time.sleep(1)
        return False

    def _release_lock(self):
        """Release file lock"""
        if self._lock_fd:
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
                self._lock_fd.close()
            except Exception:
                pass
            self._lock_fd = None


# =============================================================================
# Job Processor (Dispatch)
# =============================================================================

class JobProcessor:
    """Processes jobs by dispatching to the correct handler"""

    def __init__(self, config: Config, api: APIClient, redis_client: RedisClient):
        self.config = config
        self.api = api
        self.provision_processor = ProvisionProcessor(config, api, redis_client)

    def process(self, msg_id: str, fields: Dict[str, str]) -> bool:
        """
        Dispatch job to correct processor based on type.

        Returns True if job was processed successfully (XACK should be called)
        """
        job_type = fields.get('type')
        operation_id = fields.get('operation_id')

        logging.info(f"Processing job: {operation_id} (type={job_type})")

        if job_type == 'macct_repair':
            return self._process_macct(msg_id, fields)
        elif job_type == 'provision_host':
            return self.provision_processor.process(msg_id, fields)
        else:
            logging.warning(f"Unknown job type: {job_type}, skipping")
            return True

    def _process_macct(self, msg_id: str, fields: Dict[str, str]) -> bool:
        """Process a macct repair job (original Phase 8 logic)"""
        operation_id = fields.get('operation_id')
        host = fields.get('host')
        school = fields.get('school', 'default-school')
        attempt = int(fields.get('attempt', '0'))

        logging.info(f"Processing macct job: {operation_id} (host={host}, attempt={attempt})")

        # Update status to running
        self.api.update_status(operation_id, 'running', attempt=attempt)

        # Execute repair script
        log_file = self.config.log_dir / f"{operation_id}.log"
        result = self._execute_repair(host, school, log_file)

        if result['success']:
            self.api.update_status(operation_id, 'completed', result=result['data'])
            logging.info(f"Macct job completed: {operation_id}")
            return True
        else:
            if attempt >= self.config.max_retries:
                self.api.update_status(
                    operation_id, 'failed',
                    error=f"Max retries ({self.config.max_retries}) exceeded: {result['error']}"
                )
                logging.error(f"Macct job permanently failed: {operation_id}")
                return True
            else:
                self.api.update_status(
                    operation_id, 'retrying',
                    error=result['error'], attempt=attempt + 1
                )
                self.api.retry_job(operation_id)
                logging.warning(f"Macct job retry requested: {operation_id} (attempt {attempt + 1})")
                return True

    def _execute_repair(self, host: str, school: str, log_file: Path) -> Dict[str, Any]:
        """Execute repair_macct.py script"""
        script = self.config.repair_script

        if not Path(script).exists():
            return {'success': False, 'error': f"Repair script not found: {script}"}

        cmd = [
            'python3', script,
            '--only-hosts', host,
            '-s', school,
            '--log-file', str(log_file)
        ]

        logging.debug(f"Executing: {' '.join(cmd)}")

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=300
            )

            if result.returncode == 0:
                data = self._parse_output(result.stdout)
                return {'success': True, 'data': data}
            else:
                return {
                    'success': False,
                    'error': result.stderr or f"Script exited with code {result.returncode}"
                }
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': "Script timed out after 5 minutes"}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def _parse_output(self, stdout: str) -> Dict[str, Any]:
        """Parse repair script output"""
        data = {
            'processed': True,
            'stdout_lines': len(stdout.splitlines()) if stdout else 0
        }
        if 'unicodePwd' in stdout:
            data['unicodePwd_updated'] = True
        if 'pwdLastSet' in stdout:
            data['pwdLastSet_fixed'] = True
        if 'skipped' in stdout.lower():
            data['skipped'] = True
        if 'no changes' in stdout.lower():
            data['no_changes'] = True
        return data


# =============================================================================
# Worker Main Loop
# =============================================================================

class MacctWorker:
    """Main worker class"""

    def __init__(self, config: Config):
        self.config = config
        self.running = False
        self.redis = RedisClient(config)
        self.api = APIClient(config)
        self.processor = JobProcessor(config, self.api, self.redis)

        # Setup signal handlers
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

    def _handle_signal(self, signum, frame):
        """Handle shutdown signals"""
        logging.info(f"Received signal {signum}, shutting down...")
        self.running = False

    def run(self):
        """Main worker loop"""
        logging.info(f"Starting DC worker: {self.config.consumer_name}")
        logging.info(f"Redis: {self.config.redis_host}:{self.config.redis_port}")
        logging.info(f"API: {self.config.api_url}")

        # Connect to Redis
        try:
            self.redis.connect()
            logging.info("Connected to Redis")
        except Exception as e:
            logging.error(f"Failed to connect to Redis: {e}")
            sys.exit(1)

        # Ensure consumer group exists
        self.redis.ensure_consumer_group()

        self.running = True
        stuck_job_check_time = time.time()

        while self.running:
            try:
                # Periodically check for stuck jobs (every 5 minutes)
                if time.time() - stuck_job_check_time > 300:
                    self._process_stuck_jobs()
                    stuck_job_check_time = time.time()

                # Read new jobs
                jobs = self.redis.read_jobs()

                if not jobs:
                    continue

                for stream_name, msg_id, fields in jobs:
                    try:
                        should_ack = self.processor.process(msg_id, fields)
                        if should_ack:
                            self.redis.ack_job(msg_id)
                    except Exception as e:
                        logging.error(f"Error processing job {msg_id}: {e}")

            except redis.ConnectionError as e:
                logging.error(f"Redis connection lost: {e}")
                time.sleep(5)
                try:
                    self.redis.connect()
                    logging.info("Reconnected to Redis")
                except Exception:
                    pass

            except Exception as e:
                logging.error(f"Unexpected error: {e}")
                time.sleep(1)

        logging.info("Worker stopped")

    def _process_stuck_jobs(self):
        """Claim and process stuck jobs from other consumers"""
        stuck = self.redis.claim_stuck_jobs()
        if stuck:
            logging.info(f"Claimed {len(stuck)} stuck jobs")
            for msg_id, fields in stuck:
                try:
                    should_ack = self.processor.process(msg_id, fields)
                    if should_ack:
                        self.redis.ack_job(msg_id)
                except Exception as e:
                    logging.error(f"Error processing stuck job {msg_id}: {e}")


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='LINBO Docker DC Worker')
    parser.add_argument(
        '--config', '-c',
        help='Path to configuration file',
        default='/etc/macct-worker.conf'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose logging'
    )

    args = parser.parse_args()

    # Load configuration
    config = Config(args.config if Path(args.config).exists() else None)

    # Setup logging
    logger = setup_logging(config.log_dir)

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Create and run worker
    worker = MacctWorker(config)
    worker.run()


if __name__ == '__main__':
    main()
