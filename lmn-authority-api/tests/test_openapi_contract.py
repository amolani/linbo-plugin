"""OpenAPI contract test: implementation vs spec (AC-7 spec-drift killer).

Validates that the FastAPI-generated OpenAPI schema matches the reference
specification at docs/phase0/openapi-lmn-authority-v1.yaml.

Comparison approach (from plan):
1. Both specs are structurally valid OpenAPI 3.1
2. All spec paths + HTTP methods must exist in implementation
3. All spec component schemas must exist in implementation
4. Per schema: required fields, property keys, property types must match
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

SPEC_PATH = Path(__file__).resolve().parents[2] / "docs" / "phase0" / "openapi-lmn-authority-v1.yaml"


@pytest.fixture(scope="module")
def spec_schema() -> dict:
    """Load the reference OpenAPI spec from YAML."""
    assert SPEC_PATH.exists(), f"Spec file not found: {SPEC_PATH}"
    with open(SPEC_PATH) as f:
        return yaml.safe_load(f)


@pytest.fixture(scope="module")
def impl_schema() -> dict:
    """Get the FastAPI-generated OpenAPI schema."""
    from lmn_authority.config import Settings
    from lmn_authority.main import create_app

    fixtures = Path(__file__).parent / "fixtures"
    settings = Settings(
        devices_csv_path=fixtures / "devices.csv",
        start_conf_dir=fixtures,
        delta_db_path=Path("/tmp/test_contract_openapi.db"),
        bearer_tokens="test-token",
        ip_allowlist="0.0.0.0/0,::0/0",
        trust_proxy_headers=False,
        server_ip="10.0.0.1",
        subnet="10.0.0.0",
        netmask="255.255.0.0",
        gateway="10.0.0.254",
        dns="10.0.0.1",
        domain="linuxmuster.lan",
        dhcp_interface="eth0",
        log_level="WARNING",
    )
    app = create_app(settings=settings)
    return app.openapi()


# ── Structural Validity ──────────────────────────────────────────────────


def test_spec_is_valid_openapi(spec_schema):
    """Reference spec is valid OpenAPI 3.1."""
    from openapi_spec_validator import validate

    validate(spec_schema)


def test_impl_is_valid_openapi(impl_schema):
    """Implementation-generated spec is valid OpenAPI."""
    from openapi_spec_validator import validate

    validate(impl_schema)


# ── Paths + Methods ──────────────────────────────────────────────────────

HTTP_METHODS = {"get", "post", "put", "delete", "patch", "head", "options"}


def _extract_path_methods(schema: dict) -> dict[str, set[str]]:
    """Extract {path: {method, ...}} from an OpenAPI schema."""
    result = {}
    for path, path_item in schema.get("paths", {}).items():
        methods = set(path_item.keys()) & HTTP_METHODS
        if methods:
            result[path] = methods
    return result


def test_all_spec_paths_exist_in_implementation(spec_schema, impl_schema):
    """Every path+method in the spec must exist in the implementation."""
    spec_paths = _extract_path_methods(spec_schema)
    impl_paths = _extract_path_methods(impl_schema)

    missing = []
    for path, methods in spec_paths.items():
        if path not in impl_paths:
            missing.append(f"  Path missing: {path}")
        else:
            for method in methods:
                if method not in impl_paths[path]:
                    missing.append(f"  Method missing: {method.upper()} {path}")

    assert not missing, "Spec paths/methods missing in implementation:\n" + "\n".join(missing)


def test_no_extra_api_paths_in_implementation(spec_schema, impl_schema):
    """Implementation should not have API paths not in the spec (catch unplanned endpoints)."""
    spec_paths = set(spec_schema.get("paths", {}).keys())
    impl_paths = set(impl_schema.get("paths", {}).keys())

    # Only check /api/ paths — FastAPI may add /openapi.json, /docs, etc.
    extra = {p for p in impl_paths - spec_paths if p.startswith("/api/")}
    assert not extra, f"Extra API paths in implementation not in spec: {extra}"


# ── Component Schemas ────────────────────────────────────────────────────


def _get_schemas(schema: dict) -> dict:
    """Extract components.schemas from an OpenAPI schema."""
    return schema.get("components", {}).get("schemas", {})


# Spec uses "Error", implementation uses "ErrorResponse"
_SCHEMA_NAME_MAP = {"Error": "ErrorResponse"}


def test_all_spec_schemas_exist_in_implementation(spec_schema, impl_schema):
    """Every schema in the spec must exist in the implementation."""
    spec_schemas = set(_get_schemas(spec_schema).keys())
    impl_schemas = set(_get_schemas(impl_schema).keys())

    mapped = {_SCHEMA_NAME_MAP.get(s, s) for s in spec_schemas}
    missing = mapped - impl_schemas
    assert not missing, f"Spec schemas missing in implementation: {missing}"


def _resolve_type(prop: dict) -> str | None:
    """Extract the effective type from a property, handling anyOf/oneOf and list types."""
    if "type" in prop:
        t = prop["type"]
        # OpenAPI 3.1 allows type: ['string', 'null'] — extract the non-null type
        if isinstance(t, list):
            for item in t:
                if item != "null":
                    return item
            return t[0] if t else None
        return t
    # Pydantic uses anyOf for optional types
    for key in ("anyOf", "oneOf"):
        if key in prop:
            types = [item.get("type") for item in prop[key] if "type" in item]
            # Return first non-null type
            for t in types:
                if t != "null":
                    return t
    if "$ref" in prop:
        return "$ref"
    return None


@pytest.mark.parametrize(
    "schema_name",
    [
        "HealthResponse",
        "DeltaResponse",
        "HostRecord",
        "HostPolicies",
        "StartConfRecord",
        "ConfigRecord",
        "OsEntry",
        "PartitionEntry",
        "GrubPolicy",
        "DhcpReservation",
        "BootPolicy",
        "WebhookRegistration",
        "WebhookResponse",
        "Error",
    ],
)
def test_schema_properties_match(schema_name, spec_schema, impl_schema):
    """For each schema: required fields, property keys, and property types must match."""
    spec_schemas = _get_schemas(spec_schema)
    impl_schemas = _get_schemas(impl_schema)

    # Error schema in spec maps to ErrorResponse in implementation
    impl_name = "ErrorResponse" if schema_name == "Error" else schema_name

    if impl_name not in impl_schemas:
        pytest.skip(f"{impl_name} not in implementation schemas")

    spec_s = spec_schemas[schema_name]
    impl_s = impl_schemas[impl_name]

    # Check required fields
    spec_required = set(spec_s.get("required", []))
    impl_required = set(impl_s.get("required", []))
    missing_required = spec_required - impl_required
    assert not missing_required, (
        f"{schema_name}: required fields in spec but not in impl: {missing_required}"
    )

    # Check property keys
    spec_props = set(spec_s.get("properties", {}).keys())
    impl_props = set(impl_s.get("properties", {}).keys())
    missing_props = spec_props - impl_props
    assert not missing_props, (
        f"{schema_name}: properties in spec but not in impl: {missing_props}"
    )

    # Check property types match
    type_mismatches = []
    for prop_name in spec_props & impl_props:
        spec_type = _resolve_type(spec_s["properties"][prop_name])
        impl_type = _resolve_type(impl_s["properties"][prop_name])

        if spec_type and impl_type and spec_type != impl_type:
            # Allow compatible type mappings
            compatible = {
                ("integer", "number"),
                ("number", "integer"),
            }
            if (spec_type, impl_type) not in compatible:
                type_mismatches.append(
                    f"  {prop_name}: spec={spec_type}, impl={impl_type}"
                )

    assert not type_mismatches, (
        f"{schema_name}: type mismatches:\n" + "\n".join(type_mismatches)
    )
