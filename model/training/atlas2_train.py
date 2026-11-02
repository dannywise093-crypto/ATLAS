import json
import numpy as np
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]

vocab = json.loads(
    (BASE / "tokenizer" / "vocabulary.json").read_text()
)

sentences = (
    BASE / "training" / "atlas_training.txt"
).read_text().lower().splitlines()

rng = np.random.default_rng(42)

vocab_size = len(vocab)
embedding_dim = 32
hidden_dim = 64

E = rng.normal(0, 0.05, (vocab_size, embedding_dim))
W1 = rng.normal(0, 0.05, (embedding_dim, hidden_dim))
W2 = rng.normal(0, 0.05, (hidden_dim, vocab_size))
b = np.zeros(vocab_size)

# Create sequence-based training examples.
examples = []

for sentence in sentences:
    words = sentence.split()

    for i in range(1, len(words)):
        context = words[:i]
        target = words[i]

        if all(word in vocab for word in context) and target in vocab:
            examples.append((
                [vocab[word] for word in context],
                vocab[target]
            ))

learning_rate = 0.02
epochs = 200

for epoch in range(epochs):
    total_loss = 0.0

    for context, target in examples:
        # Represent the entire preceding context.
        x = E[context].mean(axis=0)

        # Forward pass.
        hidden = np.tanh(x @ W1)
        logits = hidden @ W2 + b

        logits -= np.max(logits)
        probabilities = np.exp(logits)
        probabilities /= probabilities.sum()

        total_loss -= np.log(probabilities[target] + 1e-12)

        # Backpropagation.
        gradient = probabilities.copy()
        gradient[target] -= 1

        dW2 = np.outer(hidden, gradient)
        db = gradient

        dh = W2 @ gradient
        dz = dh * (1 - hidden ** 2)

        dW1 = np.outer(x, dz)
        dx = W1 @ dz

        # Update parameters.
        W2 -= learning_rate * dW2
        b -= learning_rate * db
        W1 -= learning_rate * dW1

        # Distribute context gradient across its words.
        for token_id in context:
            E[token_id] -= learning_rate * dx / len(context)

    if (epoch + 1) % 20 == 0:
        print(
            f"Epoch {epoch + 1}: "
            f"loss = {total_loss / len(examples):.4f}"
        )

checkpoint = BASE / "checkpoints" / "atlas2_context_model.npz"

np.savez(
    checkpoint,
    embeddings=E,
    W1=W1,
    W2=W2,
    bias=b
)

print("\nATLAS-2 context training completed.")
print("Training sequences:", len(examples))
print("Vocabulary size:", vocab_size)
print("Saved:", checkpoint)
