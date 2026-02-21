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

val atakApiMinVersion = "4.6.0.5"
val atakApiTargetVersion = "5.2"
val atakCompatibleVersion = providers.gradleProperty("atak.compatible.version").orElse(atakApiMinVersion)

val defaultAethercoreJniDir = rootProject.file("../../external/aethercore-jni")
val aethercoreJniDir = localProperties.getProperty("aethercore.jni.dir")?.let(::file) ?: defaultAethercoreJniDir

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

fun parseVersion(version: String): List<Int> =
    version.split('.').map { token ->
        token.toIntOrNull() ?: throw GradleException("Invalid ATAK version token '$token' in '$version'")
    }

fun compareVersions(left: String, right: String): Int {
    val leftParts = parseVersion(left)
    val rightParts = parseVersion(right)
    val maxSize = maxOf(leftParts.size, rightParts.size)
    for (index in 0 until maxSize) {
        val leftToken = leftParts.getOrElse(index) { 0 }
        val rightToken = rightParts.getOrElse(index) { 0 }
        if (leftToken != rightToken) {
            return leftToken.compareTo(rightToken)
        }
    }
    return 0
}

fun extractAtakApiContract(pluginXmlContents: String): Pair<String, String> {
    val match = Regex("""<atak-api\s+min=\"([^\"]+)\"\s+target=\"([^\"]+)\"\s*/?>""")
        .find(pluginXmlContents)
        ?: throw GradleException("Missing <atak-api min=... target=...> in src/main/assets/plugin.xml")
    return match.groupValues[1] to match.groupValues[2]
}

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

val verifyAtakCompatibilityContract by tasks.registering {
    doLast {
        val pluginXml = project.layout.projectDirectory.file("src/main/assets/plugin.xml").asFile
        val (descriptorMin, descriptorTarget) = extractAtakApiContract(pluginXml.readText())

        if (descriptorMin != atakApiMinVersion || descriptorTarget != atakApiTargetVersion) {
            throw GradleException(
                "ATAK compatibility contract drift detected. " +
                    "plugin.xml has min=$descriptorMin target=$descriptorTarget, " +
                    "but Gradle expects min=$atakApiMinVersion target=$atakApiTargetVersion."
            )
        }

        val configuredVersion = atakCompatibleVersion.get()
        if (compareVersions(configuredVersion, atakApiMinVersion) < 0) {
            throw GradleException(
                "atak.compatible.version=$configuredVersion is below supported minimum $atakApiMinVersion"
            )
        }
    }
}

val verifyAtakSdkPrerequisites by tasks.registering {
    dependsOn(verifyAtakCompatibilityContract)

    doLast {
        val libsDir = project.layout.projectDirectory.dir("libs").asFile
        val missingArtifacts = requiredAtakArtifacts.filterNot { artifactName ->
            libsDir.resolve(artifactName).exists()
        }

        val hasLocalArtifacts = missingArtifacts.isEmpty()
        val hasPrivateMavenConfig = !atakPrivateMavenUrl.isNullOrBlank() && atakPrivateMavenArtifacts.isNotEmpty()

        if (!hasLocalArtifacts && !hasPrivateMavenConfig) {
            throw GradleException(
                "ATAK SDK prerequisites are missing. Compatible target: ${atakCompatibleVersion.get()}. " +
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
    dependsOn(verifyAtakCompatibilityContract)
    dependsOn(verifyAtakSdkPrerequisites)
}

repositories {
    if (!atakPrivateMavenUrl.isNullOrBlank()) {
        maven {
            url = uri(atakPrivateMavenUrl)
        }
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
