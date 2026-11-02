import sys
import re
import json
import numpy as np
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

from atlas_model_loader import load_atlas

model, vocab = load_atlas()

validation_file = BASE / "atlas_validation.txt"
sentences = validation_file.read_text(encoding="utf-8").splitlines()

def tokenize(text):
    return re.findall(r"\w+|[^\w\s]", text.lower())

total_words = 0
recognized_words = 0
unknown_words = set()

total_loss = 0.0
correct = 0
total_predictions = 0
evaluated_sentences = 0

for sentence in sentences:
    words = tokenize(sentence)
    total_words += len(words)

    unknown = [word for word in words if word not in vocab]
    recognized_words += len(words) - len(unknown)
    unknown_words.update(unknown)

    if unknown or len(words) < 2:
        continue

    ids = [vocab[word] for word in words]
    logits = model.forward(ids[:-1])

    targets = np.array(ids[1:])
    shifted = logits - np.max(logits, axis=1, keepdims=True)
    log_probs = shifted - np.log(
        np.exp(shifted).sum(axis=1, keepdims=True)
    )

    total_loss += -np.sum(log_probs[np.arange(len(targets)), targets])
    predictions = np.argmax(logits, axis=1)

    correct += int(np.sum(predictions == targets))
    total_predictions += len(targets)
    evaluated_sentences += 1

print("ATLAS VALIDATION REPORT")
print("-" * 40)
print("Validation sentences:", len(sentences))
print("Vocabulary coverage:",
      f"{recognized_words}/{total_words}",
      f"({recognized_words / total_words:.1%})")

print("Unknown words:", sorted(unknown_words))
print("Fully recognized sentences:", evaluated_sentences)

if total_predictions:
    print("Validation loss:", round(total_loss / total_predictions, 6))
    print("Next-token accuracy:", f"{correct / total_predictions:.2%}")
else:
    print("Validation loss: Not available")
    print("Next-token accuracy: Not available")

print("-" * 40)
print("Evaluation completed.")
