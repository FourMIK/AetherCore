cmake_minimum_required(VERSION 3.14.7)
project(AetherCoreJNI)

set(AETHERCORE_JNI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../external/aethercore-jni" CACHE PATH "Path to the Rust JNI crate that builds libaethercore_jni.so")
get_filename_component(RUST_DIR "${AETHERCORE_JNI_DIR}" ABSOLUTE)

if(NOT EXISTS "${RUST_DIR}")
    message(FATAL_ERROR
        "AetherCore JNI crate not found at '${RUST_DIR}'.\n"
        "Set -DAETHERCORE_JNI_DIR=<path-to-aethercore-jni> or checkout the crate at 'external/aethercore-jni'.\n"
        "See plugins/atak-trust-overlay/README.md for setup instructions."
    )
endif()

if(NOT EXISTS "${RUST_DIR}/Cargo.toml")
    message(FATAL_ERROR
        "AetherCore JNI crate is missing Cargo.toml at '${RUST_DIR}/Cargo.toml'.\n"
        "Point -DAETHERCORE_JNI_DIR to the Rust crate root for libaethercore_jni.so."
    )
endif()

find_program(CARGO_BIN cargo)
if(NOT CARGO_BIN)
    message(FATAL_ERROR "Rust cargo was not found on PATH. Install Rust via https://rustup.rs/.")
endif()

execute_process(
    COMMAND ${CARGO_BIN} ndk --version
    RESULT_VARIABLE CARGO_NDK_RESULT
    OUTPUT_QUIET
    ERROR_QUIET
)
if(NOT CARGO_NDK_RESULT EQUAL 0)
    message(FATAL_ERROR
        "cargo-ndk is required but was not found. Install with: cargo install cargo-ndk"
    )
endif()

add_custom_target(cargo_build_aethercore ALL
    COMMAND ${CARGO_BIN} ndk -t ${ANDROID_ABI} -o ${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs build --release
    WORKING_DIRECTORY ${RUST_DIR}
)

add_library(aethercore_jni SHARED IMPORTED GLOBAL)
set_target_properties(aethercore_jni PROPERTIES
    IMPORTED_LOCATION ${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libaethercore_jni.so
)
add_dependencies(aethercore_jni cargo_build_aethercore)
