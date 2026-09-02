{
  description = "Inkwell — a gamified journaling and vocabulary app";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEach = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forEach (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 pkgs.just ];
        };
      });

      apps = forEach (pkgs: {
        default = {
          type = "app";
          program = "${pkgs.writeShellScript "inkwell" ''
            exec ${pkgs.nodejs_24}/bin/node ${self}/server/index.js "$@"
          ''}";
        };
      });
    };
}
