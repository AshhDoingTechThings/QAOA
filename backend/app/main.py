"""FastAPI backend for the Hybrid Quantum-Classical Healthcare Resource
Optimisation demo.  Also serves the 3D frontend from ../../frontend."""
from __future__ import annotations

import time
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import qaoa as Q
from .benchmark import run_benchmark
from .qubo import build_model, describe_solution, model_payload, suggest_penalties
from .scenario import MAX_QUBITS, PRESETS, Scenario
from .solvers import encode_alloc, exact, greedy, simulated_annealing

app = FastAPI(title="Hybrid Quantum-Classical Healthcare Optimiser (QAOA)", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


class Noise(BaseModel):
    enabled: bool = False
    e1: float = Field(default=0.001, ge=0, le=0.2)
    e2: float = Field(default=0.01, ge=0, le=0.3)
    readout: float = Field(default=0.02, ge=0, le=0.3)
    trajectories: int = Field(default=64, ge=4, le=256)


