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


