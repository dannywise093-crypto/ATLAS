import json
import re
import sys
from pathlib import Path

import numpy as np

BASE = Path(__file__).resolve().parents[1]
TRAINING = BASE / "training"
TOKENIZER = BASE / "tokenizer"
CHECKPOINTS = BASE / "checkpoints"

sys.path.insert(0, str(TRAINING))

from atlas_transformer_train import (
    ATLASTransformer,
    cross_entropy_loss,
    transformer_backward
)

from atlas_adam import Adam

PARAMETERS = [
    "embedding", "Wq", "Wk", "Wv", "Wo",
    "W1", "b1", "W2", "b2", "Wout", "bout"
]


def tokenize(text):
    return re.findall(r"\w+|[^\w\s]", text.lower())


def load_data():
    dataset = TRAINING / "atlas_training.txt"
    vocab_file = TOKENIZER / "vocabulary.json"

    texts = dataset.read_text(encoding="utf-8").splitlines()
    vocab = json.loads(vocab_file.read_text(encoding="utf-8"))

    sequences = []

    for text in texts:
        tokens = tokenize(text)

        if len(tokens) < 2:
            continue

        ids = [vocab[token] for token in tokens]

        sequences.append(
            np.asarray(ids, dtype=np.int64)
        )

    return vocab, sequences


def train(epochs=100, learning_rate=0.001):
    vocab, sequences = load_data()

    model = ATLASTransformer(
        vocab_size=len(vocab)
    )

    optimizer = Adam(
        learning_rate=learning_rate
    )

    print("ATLAS TRANSFORMER TRAINING")
    print("-" * 45)
    print("Vocabulary:", len(vocab))
    print("Training sentences:", len(sequences))
    print("Epochs:", epochs)
    print("Learning rate:", learning_rate)

    for epoch in range(1, epochs + 1):
        total_loss = 0.0

        for sequence in sequences:
            inputs = sequence[:-1]
            targets = sequence[1:]

            logits = model.forward(inputs)

            loss = cross_entropy_loss(
                logits,
                targets
            )

            gradients = transformer_backward(
                model,
                logits,
                targets
            )

            parameters = {
                name: getattr(model, name)
                for name in PARAMETERS
            }

            optimizer.update(
                parameters,
                gradients
            )

            total_loss += loss

        average_loss = total_loss / len(sequences)

        if epoch == 1 or epoch % 10 == 0:
            print(
                f"Epoch {epoch:3d}/{epochs} "
                f"| Loss: {average_loss:.6f}"
            )

    CHECKPOINTS.mkdir(parents=True, exist_ok=True)

    checkpoint = CHECKPOINTS / "atlas_transformer_v1.npz"

    save_data = {
        name: getattr(model, name)
        for name in PARAMETERS
    }

    save_data["position"] = model.position

    np.savez(
        checkpoint,
        **save_data
    )

    metadata = {
        "model": "ATLAS Transformer",
        "version": "1.0",
        "vocab_size": len(vocab),
        "embedding_dim": model.embedding_dim,
        "num_heads": model.num_heads,
        "hidden_dim": model.W1.shape[1],
        "max_length": model.max_length,
        "epochs": epochs,
        "learning_rate": learning_rate,
        "optimizer": "Adam",
        "final_loss": float(average_loss),
        "vocabulary": vocab
    }

    metadata_file = CHECKPOINTS / "atlas_transformer_v1.json"

    metadata_file.write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8"
    )

    print("-" * 45)
    print("Training experiment completed.")
    print("Final loss:", average_loss)
    print("Weights:", checkpoint)
    print("Metadata:", metadata_file)


if __name__ == "__main__":
    train()
