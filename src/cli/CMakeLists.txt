add_executable(whatcable-linux main.cpp)
target_link_libraries(whatcable-linux PRIVATE whatcablecore Qt6::Core)
install(TARGETS whatcable-linux DESTINATION bin)
