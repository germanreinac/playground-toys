# Playground

A play mat and a box of 3D toys, in the browser. Build a little town, then press
**Release the kids!** and see how much is still standing when they leave.

- No build step: plain ES modules. Serve the folder and open it.
- three.js for drawing, cannon-es for the physics (both vendored, see their licences in vendor/).
- What you build is saved in the browser (localStorage).

Run it locally:

    python3 -m http.server 8000

Then open http://localhost:8000

To put it online with GitHub Pages: Settings > Pages > Deploy from a branch > main, / (root).
