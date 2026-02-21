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


val defaultAethercoreJniDir = rootProject.file("../../external/aethercore-jni")
val aethercoreJniDir = localProperties.getProperty("aethercore.jni.dir")?.let(::file) ?: defaultAethercoreJniDir
val atakRequiredArtifacts = providers.gradleProperty("atak.required.artifacts").orElse("main.jar")

val atakCompatibleVersion = localProperties.getProperty("atak.compatible.version") ?: "ATAK-CIV 5.2.x"
val requiredAtakArtifacts =
    (localProperties.getProperty("atak.required.artifacts") ?: "atak-sdk.jar,atak-plugin-sdk.aar")
        .split(',')
        .map { it.trim() }
        .filter { it.isNotEmpty() }

val atakPrivateMavenUrl = localProperties.getProperty("atak.maven.url")
val atakPrivateMavenArtifacts =
    (localProperties.getProperty("atak.maven.artifacts") ?: "")
        .split(',')
        .map { it.trim() }
        .filter { it.isNotEmpty() }

val verifyAethercoreJniCrate by tasks.registering {
    doLast {
        if (!aethercoreJniDir.exists()) {
            throw GradleException(
                "AetherCore JNI crate not found at '${aethercoreJniDir.invariantSeparatorsPath}'. " +
                    "Checkout the JNI crate at external/aethercore-jni or set aethercore.jni.dir in local.properties."
            )
        }
        val cargoToml = aethercoreJniDir.resolve("Cargo.toml")
        if (!cargoToml.exists()) {
            throw GradleException(
                "AetherCore JNI crate is missing Cargo.toml at '${cargoToml.invariantSeparatorsPath}'. " +
                    "Point aethercore.jni.dir to the JNI crate root."
            )
        }
    }
}

val verifyAtakSdkPrerequisites by tasks.registering {
    doLast {
        val libsDir = project.layout.projectDirectory.dir("libs").asFile
        val missingArtifacts = requiredAtakArtifacts.filterNot { artifactName ->
            libsDir.resolve(artifactName).exists()
        }

        val hasLocalArtifacts = missingArtifacts.isEmpty()
        val hasPrivateMavenConfig = !atakPrivateMavenUrl.isNullOrBlank() && atakPrivateMavenArtifacts.isNotEmpty()

        if (!hasLocalArtifacts && !hasPrivateMavenConfig) {
            throw GradleException(
                "ATAK SDK prerequisites are missing. Compatible target: $atakCompatibleVersion. " +
                    "Expected artifacts in ${libsDir.invariantSeparatorsPath}: ${requiredAtakArtifacts.joinToString()}. " +
                    "Missing: ${missingArtifacts.joinToString()}. " +
                    "Either copy the required ATAK SDK .jar/.aar files into libs/ " +
                    "or configure atak.maven.url and atak.maven.artifacts in local.properties."
            )
        }
    }
}

tasks.matching { it.name == "preBuild" }.configureEach {
    dependsOn(verifyAethercoreJniCrate)
    dependsOn(verifyAtakSdkPrerequisites)
}

repositories {
    if (!atakPrivateMavenUrl.isNullOrBlank()) {
        maven {
            url = uri(atakPrivateMavenUrl)
        }
    }
}


val atakCompatibleVersion = providers.gradleProperty("atak.compatible.version").orElse("4.6.0.5")

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

        buildConfigField("String", "ATAK_COMPATIBLE_VERSION", "\"${atakCompatibleVersion.get()}\"")
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

    buildFeatures {
        buildConfig = true
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
    compileOnly(fileTree(mapOf("dir" to "libs", "include" to listOf("*.jar", "*.aar"))))
    atakPrivateMavenArtifacts.forEach { coordinate ->
        compileOnly(coordinate)
    }

    testImplementation("junit:junit:4.13.2")
}
