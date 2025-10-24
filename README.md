# BubbleCraft
This project is aiming to make a light-weight, instant playable, online, Minecraft-like sandbox game.

The current in-browser implementation now uses Babylon.js for rendering and chunk meshing. The legacy Three.js pipeline has been removed in favor of Babylon-native systems. Core systems—engine bootstrap, input, player controller, voxel generation—have been rebuilt around Babylon APIs to better support future gameplay work.

## Developer Setup (2025-10)

- Install dependencies: `npm install`
- Start the dev server: `npm run dev`
- Build for production: `npm run build`

## Code Structure

- `src/core/` – engine bootstrap, shared context, cross-cutting services.
- `src/world/` – voxel data model, terrain generation, chunk meshing.
- `src/gameplay/` – entities, inventory, interaction, systems.
- `src/ui/` – HUD and interface components.
- `src/input/` – keyboard/mouse/touch handling.
- `src/assets/` – static media (sounds, textures).
- `src/legacy/` – archived vendor assets kept for reference.

![Screenshot 2025-10-08 at 9 01 50 PM (2)](https://github.com/user-attachments/assets/38d8122b-466f-46ab-839e-50a390ee23cb)

Try it now at this URL: https://bubblewong.github.io/BubbleCraft/
