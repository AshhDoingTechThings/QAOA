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


class Scenario(BaseModel):
    name: str = "Custom scenario"
    resource: str = "Ventilators"
    unit_size: int = Field(default=1, ge=1, le=1000)
    unit_label: str = "ventilators"
    supply: int = Field(ge=0, le=24)
    facilities: List[Facility]
    lambdas: Lambdas = Lambdas()
    description: Optional[str] = None

    @field_validator("facilities")
    @classmethod
    def _n_fac(cls, v):
        if not 2 <= len(v) <= 6:
            raise ValueError("Use between 2 and 6 facilities")
        return v


def _f(name, kind, d, c, cost, pr, m):
    return Facility(name=name, kind=kind, demand=d, capacity=c, cost=cost, priority=pr, min_service=m)


PRESETS = {
    "ventilators": Scenario(
        name="Ventilator distribution",
        resource="Ventilators", unit_size=5, unit_label="ventilators",
        supply=6,
        description="A regional health authority has 6 batches of ventilators (30 devices) "
                    "for 4 facilities whose combined demand is 10 batches. Who gets what?",
        facilities=[
            _f("City General", "hospital", 3, 3, 1.0, 3.0, 1),
            _f("Rural Health Centre", "rural", 2, 2, 2.0, 2.0, 1),
            _f("Children's Hospital", "children", 2, 3, 1.5, 3.0, 0),
            _f("Trauma Centre", "trauma", 3, 2, 1.2, 2.5, 1),
        ],
    ),
    "pandemic": Scenario(
        name="Pandemic surge — ICU beds",
        resource="ICU beds", unit_size=4, unit_label="ICU beds",
        supply=7,
        description="Surge planning: 7 blocks of mobile ICU beds across 5 facilities under "
                    "capacity limits and minimum-service guarantees.",
        facilities=[
            _f("Metro Hospital", "hospital", 3, 3, 1.0, 3.0, 1),
            _f("North Clinic", "clinic", 2, 2, 1.4, 1.5, 0),
            _f("Children's Hospital", "children", 2, 2, 1.6, 2.5, 1),
            _f("Trauma Centre", "trauma", 3, 3, 1.1, 3.0, 1),
            _f("Valley Rural Unit", "rural", 2, 1, 2.2, 2.0, 0),
        ],
    ),
    "nurses": Scenario(
        name="Nurse shift allocation",
        resource="Nurses", unit_size=3, unit_label="nurses / shift",
        supply=5,
        description="5 nurse teams (15 nurses) for the night shift across 3 wards.",
        facilities=[
            _f("Emergency Ward", "trauma", 3, 3, 1.0, 3.0, 1),
            _f("Paediatrics", "children", 2, 2, 1.2, 2.0, 1),
            _f("General Ward", "hospital", 2, 3, 0.8, 1.5, 0),
        ],
    ),
    "validation": Scenario(
        name="Small validation instance",
        resource="Funds", unit_size=1, unit_label="× ₹10 lakh",
        supply=3,
        description="Tiny 8-qubit instance used to validate the formulation by exact enumeration.",
        facilities=[
            _f("District Hospital", "hospital", 2, 2, 1.0, 2.0, 1),
            _f("PHC Village A", "rural", 2, 2, 1.5, 2.5, 0),
            _f("Urban Clinic", "clinic", 1, 2, 0.8, 1.0, 0),
        ],
    ),
}
