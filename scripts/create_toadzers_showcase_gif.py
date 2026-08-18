#!/usr/bin/env python3

from pathlib import Path

from PIL import Image


SIZE = 600
ARTWORK_DURATION_MS = 350
LOGO_DURATION_MS = 1200
COLORS = 128

ROOT = Path('/Users/nikitavoronin/Downloads')
ARTWORK_DIR = ROOT / 'trait-collection-nft-drop' / 'images'
ARTWORKS = [
    ARTWORK_DIR / '1.jpg',
    ARTWORK_DIR / '2.jpg',
    ARTWORK_DIR / '3.jpg',
    ARTWORK_DIR / '5.jpg',
    ARTWORK_DIR / '4.jpg',
    ARTWORK_DIR / '61.jpg',
    ARTWORK_DIR / '45.jpg',
    ARTWORK_DIR / '39.jpg',
]
LOGO = ROOT / 'toadzers_logo.png'
OUTPUT = Path(__file__).resolve().parents[1] / 'output' / 'toadzers-collection-showcase.gif'


def fit_square(path: Path, background: str = 'black') -> Image.Image:
    with Image.open(path) as source:
        image = source.convert('RGB')
        image.thumbnail((SIZE, SIZE), Image.Resampling.LANCZOS)
        canvas = Image.new('RGB', (SIZE, SIZE), background)
        canvas.paste(image, ((SIZE - image.width) // 2, (SIZE - image.height) // 2))
        return canvas


def logo_frame(path: Path) -> Image.Image:
    with Image.open(path) as source:
        logo = source.convert('RGBA')
        logo.thumbnail((int(SIZE * 0.92), int(SIZE * 0.92)), Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA', (SIZE, SIZE), 'black')
        canvas.alpha_composite(logo, ((SIZE - logo.width) // 2, (SIZE - logo.height) // 2))
        return canvas.convert('RGB')


def quantize(frame: Image.Image) -> Image.Image:
    return frame.quantize(
        colors=COLORS,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.FLOYDSTEINBERG,
    )


def main() -> None:
    missing = [path for path in [*ARTWORKS, LOGO] if not path.is_file()]
    if missing:
        raise SystemExit(f'Missing input files: {missing}')

    frames = [quantize(fit_square(path)) for path in ARTWORKS]
    frames.append(quantize(logo_frame(LOGO)))
    durations = [ARTWORK_DURATION_MS] * len(ARTWORKS) + [LOGO_DURATION_MS]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUTPUT,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f'Created {OUTPUT}')
    print(f'Frames: {len(frames)} | Size: {SIZE}x{SIZE} | Duration: {sum(durations) / 1000:.1f}s')


if __name__ == '__main__':
    main()
