import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('secret scanner keeps default rules and allows only two exact reviewed PUBLIC browser values',()=>{
 const text=readFileSync('.gitleaks.toml','utf8');assert.match(text,/useDefault = true/u);assert.match(text,/regexTarget = "secret"/u);
 assert.doesNotMatch(text,/paths\s*=|stopwords\s*=|disabledRules\s*=/u);
 assert.equal([...text.matchAll(/^\[allowlist\]$/gmu)].length,1);
 assert.doesNotMatch(text,/\[\[allowlists\]\]/u,'CI Gitleaks8.24.3 requires the compatible singular global table');
 const expressions=[...text.matchAll(/'''([^']+)'''/gu)].map(m=>m[1]!);
 assert.deepEqual(expressions,['^sb_publishable_d4TElxRQFkC-AZko3_ASeg_YotqxGjV$','^sb_publishable_XYq8HBYT6Pxa2VdRdi69CA_012vvfp5$']);
 for(const expression of expressions){const re=new RegExp(expression,'u');assert.equal(re.test('sb_secret_not_a_real_credential'),false);assert.equal(re.test('service_role'),false);assert.equal(re.test(expression.slice(1,-1)+'x'),false);}
});
