# 🎮 BubbleCraft

This project is aiming to make a light-weight, instant playable, online, Minecraft-like sandbox game.

<img width="1503" height="775" alt="Screenshot 2026-05-21 at 7 58 31 PM" src="https://github.com/user-attachments/assets/b05349e9-c285-4e55-92b5-057b3b990a18" />

The current in-browser implementation now uses Babylon.js for rendering and chunk meshing. The legacy Three.js pipeline has been removed in favor of Babylon-native systems. Core systems—engine bootstrap, input, player controller, voxel generation—have been rebuilt around Babylon APIs to better support future gameplay work.

## Developer Setup (2025-10)

No build tooling is required. Serve the repository with any static HTTP server (for example `python -m http.server`) and open `index.html` in your browser. All scripts are loaded directly in the page, and Babylon.js is pulled from the official CDN.

## Code Structure

- `src/core/` – engine bootstrap, shared context, cross-cutting services.
- `src/world/` – voxel data model, terrain generation, chunk meshing.
- `src/gameplay/` – entities, inventory, interaction, systems.
- `src/ui/` – HUD and interface components.
- `src/input/` – keyboard/mouse/touch handling.
- `src/assets/` – static media (sounds, textures).
- `src/legacy/` – archived vendor assets kept for reference.

Try it now at this URL: https://bubblewong.github.io/BubbleCraft/
