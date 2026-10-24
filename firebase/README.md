# Firebase deployment boundary

This package does not deploy automatically. Use the explicit project `techware-instructor` and review the merged rules before deployment.
The portal uses `/academyPortal/techware/…`, separate from the existing academy collections.
Existing legacy rules have two deliberate security changes: verified email is required for legacy email-key ownership; self-created staff profiles start as pending rather than instructor.
Existing approved instructors remain approved. Review any existing accounts created through self-registration before launch.

Prototype rules must be verified before sharing broadly. Local emulator tests are not proof of the deployed project's state.
