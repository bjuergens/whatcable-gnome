UUID := whatcable@whatcable.local
USER_EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SYSTEM_EXT_DIR := $(DESTDIR)/usr/share/gnome-shell/extensions/$(UUID)

FILES := metadata.json extension.js stylesheet.css buildinfo.json

.PHONY: install install-user install-system uninstall pack buildinfo help

buildinfo:
	@printf '{"buildTime": "%s"}\n' "$$(date -u +%Y-%m-%dT%H:%M:%SZ)" > buildinfo.json

help:
	@echo "Targets:"
	@echo "  install         - alias for install-user"
	@echo "  install-user    - install to ~/.local/share/gnome-shell/extensions/"
	@echo "  install-system  - install to /usr/share/gnome-shell/extensions/ (needs root)"
	@echo "  uninstall       - remove the user-installed extension"
	@echo "  pack            - build a zip suitable for gnome-extensions install"

install: install-user

install-user: buildinfo
	mkdir -p "$(USER_EXT_DIR)"
	cp $(FILES) "$(USER_EXT_DIR)/"
	@echo "Installed to $(USER_EXT_DIR)"
	@echo "Restart GNOME Shell (Alt+F2 -> r on X11, or log out on Wayland),"
	@echo "then enable with: gnome-extensions enable $(UUID)"

install-system: buildinfo
	mkdir -p "$(SYSTEM_EXT_DIR)"
	cp $(FILES) "$(SYSTEM_EXT_DIR)/"

uninstall:
	rm -rf "$(USER_EXT_DIR)"

pack: buildinfo
	gnome-extensions pack --force \
		--extra-source=stylesheet.css \
		--extra-source=buildinfo.json \
		.
