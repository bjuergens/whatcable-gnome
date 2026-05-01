add_library(whatcable-plasmoid-plugin SHARED
    plugin/WhatCablePlugin.cpp
    plugin/DeviceModel.cpp
)

target_link_libraries(whatcable-plasmoid-plugin PRIVATE
    whatcablecore
    Qt6::Core
    Qt6::Quick
)

# Install the QML plugin to the Qt QML import path so "import org.kde.whatcable" works
set(QML_INSTALL_DIR "${KDE_INSTALL_QMLDIR}/org/kde/whatcable")
install(TARGETS whatcable-plasmoid-plugin DESTINATION ${QML_INSTALL_DIR})
install(FILES plugin/qmldir DESTINATION ${QML_INSTALL_DIR})

plasma_install_package(. org.kde.whatcable)

# Build a kpackagetool6-installable package directory under build/
set(PKG_DIR "${CMAKE_BINARY_DIR}/pkg/org.kde.whatcable")
add_custom_command(TARGET whatcable-plasmoid-plugin POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${PKG_DIR}/contents/ui"
    COMMAND ${CMAKE_COMMAND} -E copy
        "${CMAKE_CURRENT_SOURCE_DIR}/metadata.json" "${PKG_DIR}/metadata.json"
    COMMAND ${CMAKE_COMMAND} -E copy
        "${CMAKE_CURRENT_SOURCE_DIR}/contents/ui/main.qml"
        "${CMAKE_CURRENT_SOURCE_DIR}/contents/ui/CompactView.qml"
        "${CMAKE_CURRENT_SOURCE_DIR}/contents/ui/DeviceCard.qml"
        "${CMAKE_CURRENT_SOURCE_DIR}/contents/ui/PowerSourceList.qml"
        "${PKG_DIR}/contents/ui/"
    # Also stage the QML plugin for local development
    COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_BINARY_DIR}/qml/org/kde/whatcable"
    COMMAND ${CMAKE_COMMAND} -E copy
        "$<TARGET_FILE:whatcable-plasmoid-plugin>"
        "${CMAKE_BINARY_DIR}/qml/org/kde/whatcable/"
    COMMAND ${CMAKE_COMMAND} -E copy
        "${CMAKE_CURRENT_SOURCE_DIR}/plugin/qmldir"
        "${CMAKE_BINARY_DIR}/qml/org/kde/whatcable/"
    COMMENT "Assembling plasmoid package and QML plugin"
)
