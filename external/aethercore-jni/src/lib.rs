use jni::objects::JClass;
use jni::sys::jstring;
use jni::JNIEnv;

#[no_mangle]
pub extern "system" fn Java_com_aethercore_atak_trustoverlay_NativeBridge_nativeHealthcheck(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    env.new_string("aethercore-jni-ok")
        .expect("JNI string allocation failed")
        .into_raw()
}
