# Inkwell — bare `just` (or `just run`) launches the whole app.

# use system node if present, otherwise pull Node 24 from the nix dev shell
node_cmd := if `command -v node || true` == '' { 'nix develop -c node' } else { 'node' }

# Launch Inkwell (API + web UI) at http://127.0.0.1:3000
run:
    {{ node_cmd }} server/index.js

# Run the full test suite
test:
    {{ node_cmd }} --test
