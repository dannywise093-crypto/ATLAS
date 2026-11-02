import json
import numpy as np
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
DATA = BASE / "training" / "atlas_training.txt"
VOCAB = BASE / "tokenizer" / "vocabulary.json"
CHECKPOINT = BASE / "checkpoints" / "atlas_toy_model.npz"

# Load vocabulary and training sentences.
vocab = json.loads(VOCAB.read_text(encoding="utf-8"))
sentences = DATA.read_text(encoding="utf-8").lower().splitlines()

# Convert sentences into next-token examples.
examples = []

for sentence in sentences:
    words = sentence.split()

    for current, target in zip(words[:-1], words[1:]):
        if current in vocab and target in vocab:
            examples.append((vocab[current], vocab[target]))

if not examples:
    raise ValueError("No training examples found.")

# Small neural network for the learning experiment.
rng = np.random.default_rng(42)
vocab_size = len(vocab)
hidden_size = 32

E = rng.normal(0, 0.05, (vocab_size, hidden_size))
W = rng.normal(0, 0.05, (hidden_size, vocab_size))
b = np.zeros(vocab_size)

learning_rate = 0.05
epochs = 200

for epoch in range(epochs):
    total_loss = 0.0

    for input_id, target_id in examples:
        x = E[input_id].copy()

        # Forward pass.
        hidden = np.tanh(x)
        logits = hidden @ W + b

        logits -= np.max(logits)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum()

        loss = -np.log(probabilities[target_id] + 1e-12)
        total_loss += loss

        # Backpropagation.
        gradient = probabilities.copy()
        gradient[target_id] -= 1

        dW = np.outer(hidden, gradient)
        db = gradient
        dh = W @ gradient
        dx = dh * (1 - hidden ** 2)

        # Parameter updates.
        W -= learning_rate * dW
        b -= learning_rate * db
        E[input_id] -= learning_rate * dx

    if (epoch + 1) % 20 == 0:
        average_loss = total_loss / len(examples)
        print(f"Epoch {epoch + 1}: loss = {average_loss:.4f}")

# Save learned parameters.
CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)

np.savez(
    CHECKPOINT,
    embeddings=E,
    weights=W,
    bias=b
)

print("\nATLAS toy training completed.")
print("Training examples:", len(examples))
print("Vocabulary size:", vocab_size)
print("Checkpoint:", CHECKPOINT)
