cmake_minimum_required(VERSION 3.20)
project(whatcable-gnome VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Core)
find_package(PkgConfig REQUIRED)
pkg_check_modules(UDEV REQUIRED libudev)

include(GNUInstallDirs)

add_subdirectory(src/core)
add_subdirectory(src/cli)

# Optional: install the GNOME Shell extension into the system extensions dir.
# Most users install via `cd gnome-extension && make install` (per-user)
# or copy the files to ~/.local/share/gnome-shell/extensions/ directly.
option(INSTALL_GNOME_EXTENSION "Install GNOME Shell extension files system-wide" OFF)
if(INSTALL_GNOME_EXTENSION)
    install(DIRECTORY gnome-extension/
        DESTINATION ${CMAKE_INSTALL_DATADIR}/gnome-shell/extensions/whatcable@whatcable.local
        PATTERN "Makefile" EXCLUDE
        PATTERN "README*" EXCLUDE
    )
endif()
