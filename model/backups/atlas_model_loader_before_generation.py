import json
import numpy as np
from pathlib import Path

from atlas_transformer_train import ATLASTransformer

BASE = Path(__file__).resolve().parents[1]
CHECKPOINTS = BASE / "checkpoints"

WEIGHTS = CHECKPOINTS / "atlas_transformer_v1.npz"
METADATA = CHECKPOINTS / "atlas_transformer_v1.json"


def load_atlas():
    metadata = json.loads(
        METADATA.read_text(encoding="utf-8")
    )

    model = ATLASTransformer(
        vocab_size=metadata["vocab_size"],
        embedding_dim=metadata["embedding_dim"],
        num_heads=metadata["num_heads"],
        hidden_dim=metadata["hidden_dim"],
        max_length=metadata["max_length"]
    )

    parameters = [
        "embedding", "Wq", "Wk", "Wv", "Wo",
        "W1", "b1", "W2", "b2", "Wout", "bout",
        "position"
    ]

    with np.load(WEIGHTS) as checkpoint:
        for name in parameters:
            value = checkpoint[name]

            if value.shape != getattr(model, name).shape:
                raise ValueError(
                    f"Checkpoint shape mismatch: {name}"
                )

            if not np.all(np.isfinite(value)):
                raise ValueError(
                    f"Invalid checkpoint values: {name}"
                )

            setattr(model, name, value.copy())

    vocabulary = metadata["vocabulary"]

    if len(vocabulary) != model.vocab_size:
        raise ValueError("Vocabulary size mismatch")

    return model, vocabulary
