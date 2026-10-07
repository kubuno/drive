// Android library: Room store, delta sync engine, workers, realtime client.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.kubuno.android.sync"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    api(libs.kubuno.core.api)
    api(libs.kubuno.core.account)

    implementation(libs.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    api(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    api(libs.work.runtime.ktx)
    implementation(libs.lifecycle.process)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)

    // JVM unit tests of the outbox policy, run against the shared conformance
    // vectors vendored under src/test/resources/vectors.
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.kubuno.core.vectors)
}
