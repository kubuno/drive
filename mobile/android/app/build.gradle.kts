plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "com.kubuno.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.kubuno.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    // Opt-in release signing, shared with the whole suite — the SAME certificate
    // must sign every Kubuno app (the shared-account model trusts by signature).
    // Pass -PkubunoKeystore=… + the passwords to sign; unsigned otherwise.
    val keystorePath = (findProperty("kubunoKeystore") as String?)?.takeIf { it.isNotBlank() }
    val keystoreFile = keystorePath?.let { rootProject.file(it) }
    signingConfigs {
        if (keystoreFile != null && keystoreFile.exists()) {
            create("release") {
                storeFile = keystoreFile
                storePassword = findProperty("kubunoKeystorePassword") as String?
                keyAlias = findProperty("kubunoKeyAlias") as String?
                keyPassword = findProperty("kubunoKeyPassword") as String?
            }
        }
    }

    buildTypes {
        release {
            // R8 stays off for drive until its keep-rules audit (mail has it).
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.kubuno.core.api)
    implementation(libs.kubuno.core.account)
    implementation(libs.kubuno.core.ui)
    implementation(libs.kubuno.core.viewer)
    implementation(project(":sync"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)

    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.activity.compose)
    implementation(libs.navigation.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)

    implementation(libs.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    implementation(libs.room.runtime)
    implementation(libs.work.runtime.ktx)
    implementation(libs.lifecycle.process)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    testImplementation(libs.junit)
}
