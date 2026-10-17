package io.github.smkrot3sudo.budget;

final class BuildConfigVersion {
    // Set per build in app/build.gradle (site and play flavors); the site one must match docs/budget/app-version.json
    static final String NAME = BuildConfig.VERSION_NAME;
    static final int CODE = BuildConfig.VERSION_CODE;
    /** The Google Play build: no self-update, no payment detection */
    static final boolean STORE = BuildConfig.STORE;
    private BuildConfigVersion() {}
}
