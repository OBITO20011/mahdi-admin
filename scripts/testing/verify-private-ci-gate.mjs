import {verifyCiBranches} from './private-ci-scope.mjs';
verifyCiBranches(JSON.parse(process.env.NEEDS_JSON), {mode: process.env.CI_MODE, packageFNeeded: process.env.CI_PACKAGE_F_NEEDED === 'true'});
console.log('Exact routed branches succeeded;light is NOT full release evidence.');
