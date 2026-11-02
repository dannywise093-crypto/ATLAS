import json
import re
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
DATASET = BASE / "training" / "atlas_training.txt"
VOCAB_OUTPUT = BASE / "tokenizer" / "atlas_bpe_vocabulary.json"
MERGES_OUTPUT = BASE / "tokenizer" / "atlas_bpe_merges.json"

SPECIAL_TOKENS = ["<PAD>", "<UNK>", "<BOS>", "<EOS>"]
NUM_MERGES = 120


def tokenize_words(text):
    return re.findall(r"\w+|[^\w\s]", text.lower(), flags=re.UNICODE)


def get_pairs(symbols):
    return Counter(zip(symbols, symbols[1:]))


def train_bpe(texts, num_merges=NUM_MERGES):
    words = Counter()

    for text in texts:
        words.update(tokenize_words(text))

    corpus = {
        tuple(list(word) + ["</w>"]): frequency
        for word, frequency in words.items()
    }

    merges = []

    for _ in range(num_merges):
        pair_counts = Counter()

        for symbols, frequency in corpus.items():
            for pair, count in get_pairs(symbols).items():
                pair_counts[pair] += count * frequency

        if not pair_counts:
            break

        best_pair, frequency = pair_counts.most_common(1)[0]

        if frequency < 2:
            break

        merged_token = "".join(best_pair)
        merges.append(list(best_pair))

        updated = {}

        for symbols, count in corpus.items():
            result = []
            index = 0

            while index < len(symbols):
                if (
                    index + 1 < len(symbols)
                    and symbols[index] == best_pair[0]
                    and symbols[index + 1] == best_pair[1]
                ):
                    result.append(merged_token)
                    index += 2
                else:
                    result.append(symbols[index])
                    index += 1

            updated[tuple(result)] = count

        corpus = updated

    vocabulary = set(SPECIAL_TOKENS)

    for symbols in corpus:
        vocabulary.update(symbols)

    return sorted(vocabulary), merges


def encode_word(word, merges):
    symbols = list(word.lower()) + ["</w>"]

    for left, right in merges:
        merged = left + right
        result = []
        index = 0

        while index < len(symbols):
            if (
                index + 1 < len(symbols)
                and symbols[index] == left
                and symbols[index + 1] == right
            ):
                result.append(merged)
                index += 2
            else:
                result.append(symbols[index])
                index += 1

        symbols = result

    return symbols


def encode(text, vocabulary, merges):
    tokens = []

    for word in tokenize_words(text):
        pieces = encode_word(word, merges)

        for piece in pieces:
            if piece in vocabulary:
                tokens.append(piece)
            else:
                tokens.append("<UNK>")

    return tokens


if __name__ == "__main__":
    texts = DATASET.read_text(encoding="utf-8").splitlines()

    vocabulary, merges = train_bpe(texts)

    vocab_map = {
        token: index
        for index, token in enumerate(vocabulary)
    }

    VOCAB_OUTPUT.write_text(
        json.dumps(vocab_map, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    MERGES_OUTPUT.write_text(
        json.dumps(merges, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    print("ATLAS BPE TOKENIZER")
    print("Training sentences:", len(texts))
    print("Vocabulary size:", len(vocab_map))
    print("Learned merges:", len(merges))
    print("Vocabulary:", VOCAB_OUTPUT)
    print("Merge rules:", MERGES_OUTPUT)
