"""Parsed config record models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class OsEntry(BaseModel):
    name: str
    version: str = ""
    iconname: str = ""
    baseimage: str = ""
    boot: str = ""
    root: str = ""
    kernel: str = ""
    initrd: str = ""
    append: str = ""
    startEnabled: bool
    syncEnabled: bool
    newEnabled: bool


class PartitionEntry(BaseModel):
    device: str
    label: str = ""
    size: str = ""
    fsType: str = ""
    bootable: bool = False


class GrubPolicy(BaseModel):
    timeout: int = Field(default=5, ge=0)
    defaultEntry: int = Field(default=0, ge=0)
    hiddenMenu: bool = False


class ConfigRecord(BaseModel):
    id: str
    name: str
    osEntries: list[OsEntry]
    partitions: list[PartitionEntry]
    grubPolicy: GrubPolicy
    updatedAt: datetime


class BatchConfigsRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)


class BatchConfigsResponse(BaseModel):
    configs: list[ConfigRecord]
