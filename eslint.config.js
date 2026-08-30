import base from "@sage/eslint-config";
import react from "@sage/eslint-config/react";
import design from "@sage/eslint-config/design";

/** Root ESLint config — shared Sage rules plus the React and design layers. */
export default [...base, ...react, ...design];
