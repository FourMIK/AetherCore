cmake_minimum_required(VERSION 3.14.7)
project(AetherCoreJNI)

set(RUST_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../crates/android-ffi)

add_custom_target(cargo_build_aethercore ALL
    COMMAND cargo ndk -t ${ANDROID_ABI} -o ${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs build --release
    WORKING_DIRECTORY ${RUST_DIR}
)

add_library(aethercore_jni SHARED IMPORTED GLOBAL)
set_target_properties(aethercore_jni PROPERTIES
    IMPORTED_LOCATION ${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libaethercore_jni.so
)
add_dependencies(aethercore_jni cargo_build_aethercore)
