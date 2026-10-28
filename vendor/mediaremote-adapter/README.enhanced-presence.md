# Vendored MediaRemote Adapter

Source: https://github.com/ungive/mediaremote-adapter
Pinned revision: `0e82bf1c44ec39554fbfc402ec88a48c6ae2a0fd`
License: BSD 3-Clause; see `LICENSE`.

The `bin/`, `include/`, `src/` and `CMakeLists.txt` files are unchanged upstream sources. `build.mjs` is the companion's build entry point. Run it with Node from any working directory; CMake and Xcode are required when building, but not when running the packaged companion.

```
node vendor/mediaremote-adapter/build.mjs
```

The script builds the upstream universal framework with the Xcode generator, ad hoc signs it using the upstream build step, and places it in `build/MediaRemoteAdapter.framework`. Package that complete framework (preserving symlinks) together with `bin/mediaremote-adapter.pl`. Runtime access uses `/usr/bin/perl` and an event stream; it does not depend on Droppy.

The companion requests full JSON frames with microsecond timing, 250ms event coalescing, and no inline artwork. Upstream exposes artwork bytes rather than public album image URLs; no images are uploaded or stored. Music falls back to the player's correct public icon when a supported public album image URL is unavailable. A fatal provider error clears music and requires an explicit restart; it does not launch a retry loop.

MediaRemote is an Apple private framework; future OS updates can prevent this adapter from reading Now Playing metadata. Compatibility requires a live check on the target OS. Do not run upstream's synthetic `test` command during a read-only smoke check: it can briefly change system Now Playing state.
