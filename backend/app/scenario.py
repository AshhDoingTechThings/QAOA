"""Healthcare allocation scenario definitions and presets.

A scenario describes ONE scarce resource (ventilators, ICU beds, nurses, funds)
that must be distributed across several facilities.  Quantities are expressed in
*units* (a unit may represent a batch, e.g. 1 unit = 5 ventilators) so that every
facility's allocation fits a 2-bit binary register (0..3 units).
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

BITS_PER_FACILITY = 2                     # a_f = x_f0 + 2·x_f1  ∈ {0,1,2,3}
MAX_UNITS = (1 << BITS_PER_FACILITY) - 1  # 3
MAX_QUBITS = 16                           # exact statevector limit for interactive use


class Facility(BaseModel):
    name: str
    kind: str = "hospital"                # hospital | clinic | children | trauma | rural (3D styling)
    demand: int = Field(ge=0, le=MAX_UNITS)
    capacity: int = Field(ge=0, le=MAX_UNITS)
    cost: float = Field(ge=0, le=20)      # cost per unit delivered (logistics/operational)
    priority: float = Field(ge=0, le=10)  # clinical priority weight of unmet demand
    min_service: int = Field(default=0, ge=0, le=MAX_UNITS)


class Lambdas(BaseModel):
    capacity: float = Field(default=12.0, ge=0)     # λ1  hard: facility capacity + total stock
    demand: float = Field(default=2.0, ge=0)        # λ2  objective: priority-weighted unmet demand
    fairness: float = Field(default=3.0, ge=0)      # λ3  soft: equity of coverage ratios
    min_service: float = Field(default=12.0, ge=0)  # λ4  hard: minimum service guarantee


