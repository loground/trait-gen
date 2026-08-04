#!/usr/bin/env python3

import argparse
import csv
from collections import Counter
from pathlib import Path

from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser(description="Create a fast GIF from metadata-diverse collection artwork.")
    parser.add_argument("metadata", type=Path)
    parser.add_argument("images", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--frames", type=int, default=50)
    parser.add_argument("--duration-ms", type=int, default=100)
    parser.add_argument("--size", type=int, default=600)
    parser.add_argument("--colors", type=int, default=128)
    return parser.parse_args()


def load_candidates(metadata_path, images_path):
    with metadata_path.open(newline="", encoding="utf-8-sig") as metadata_file:
        reader = csv.DictReader(metadata_file)
        trait_columns = [column for column in reader.fieldnames or [] if column.startswith("attributes[")]
        candidates = []
        seen_combinations = set()
        for row in reader:
            image_path = images_path / row["file_name"]
            traits = tuple(row.get(column, "").strip() for column in trait_columns)
            if image_path.is_file() and traits not in seen_combinations:
                seen_combinations.add(traits)
                candidates.append({"row": row, "path": image_path, "traits": traits})
    return candidates, trait_columns


def select_diverse(candidates, frame_count):
    frequencies = [Counter(candidate["traits"][index] for candidate in candidates) for index in range(len(candidates[0]["traits"]))]

    def rarity(candidate):
        return sum(1 / frequencies[index][value] for index, value in enumerate(candidate["traits"]) if value)

    remaining = list(candidates)
    first = max(remaining, key=rarity)
    selected = [first]
    remaining.remove(first)
    covered = [{value} if value else set() for value in first["traits"]]

    while remaining and len(selected) < frame_count:
        def diversity_score(candidate):
            new_values = sum(
                1 for index, value in enumerate(candidate["traits"]) if value and value not in covered[index]
            )
            nearest_distance = min(
                sum(left != right for left, right in zip(candidate["traits"], chosen["traits"]))
                for chosen in selected
            )
            return new_values * 10 + nearest_distance * 2 + rarity(candidate)

        chosen = max(remaining, key=diversity_score)
        selected.append(chosen)
        remaining.remove(chosen)
        for index, value in enumerate(chosen["traits"]):
            if value:
                covered[index].add(value)
    return selected


def prepare_frame(image_path, size, colors):
    with Image.open(image_path) as image:
        frame = image.convert("RGB")
        frame.thumbnail((size, size), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (size, size), "black")
        canvas.paste(frame, ((size - frame.width) // 2, (size - frame.height) // 2))
        return canvas.quantize(
            colors=colors,
            method=Image.Quantize.MEDIANCUT,
            dither=Image.Dither.NONE,
        )


def main():
    args = parse_args()
    candidates, trait_columns = load_candidates(args.metadata, args.images)
    if not candidates:
        raise SystemExit("No metadata rows had matching image files.")

    selected = select_diverse(candidates, min(args.frames, len(candidates)))
    frames = [prepare_frame(candidate["path"], args.size, args.colors) for candidate in selected]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        args.output,
        save_all=True,
        append_images=frames[1:],
        duration=args.duration_ms,
        loop=0,
        optimize=True,
        disposal=2,
    )

    total_seconds = len(frames) * args.duration_ms / 1000
    print(f"Created {args.output}")
    print(f"Frames: {len(frames)} | Duration: {total_seconds:.1f}s | Trait columns: {len(trait_columns)}")
    print("Selected token IDs:", ",".join(candidate["row"]["tokenID"] for candidate in selected))


if __name__ == "__main__":
    main()
