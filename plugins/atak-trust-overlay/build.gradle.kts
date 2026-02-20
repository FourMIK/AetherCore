import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProperties = Properties().apply {
    val localPropertiesFile = rootProject.file("local.properties")
    if (localPropertiesFile.exists()) {
        load(localPropertiesFile.inputStream())
    }
}

android {
    namespace = "com.aethercore.atak.trustoverlay"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.aethercore.atak.trustoverlay"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0-AetherCore"

        externalNativeBuild {
            cmake {
                arguments("-DANDROID_STL=c++_shared")
                targets("aethercore_jni")
            }
        }

        ndk {
            abiFilters.addAll(listOf("armeabi-v7a", "arm64-v8a"))
        }
    }

    signingConfigs {
        create("release") {
            storeFile = file(localProperties.getProperty("keystore.path") ?: "default.jks")
            storePassword = localProperties.getProperty("keystore.password") ?: ""
            keyAlias = localProperties.getProperty("key.alias") ?: ""
            keyPassword = localProperties.getProperty("key.password") ?: ""
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            isJniDebuggable = true
        }
    }

    externalNativeBuild {
        cmake {
            path("CMakeLists.txt")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib")

    compileOnly(fileTree(mapOf("dir" to "libs", "include" to listOf("*.jar", "*.aar"))))

    testImplementation("junit:junit:4.13.2")
}
