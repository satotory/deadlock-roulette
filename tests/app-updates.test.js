import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_VERSION, PROJECT_LINKS } from '../src/app-version.js';
import { isNewerVersion, parseWebRelease, safeUpdateState, versionParts } from '../src/app-updates.js';

test('release comparisons handle numeric multi-digit versions without prerelease or malformed upgrades', () => {
  assert(isNewerVersion('1.10.0','1.9.9')); assert(isNewerVersion('v2.0.0','1.99.99'));
  for(const candidate of ['1.10.0','1.9.0','1.10.0-beta.1','01.11.0','javascript:1.11.0','1.11','1.0.99999999999999999']) assert.equal(isNewerVersion(candidate,'1.10.0'),false,candidate);
  assert.deepEqual(versionParts('v1.10.0'),[1,10,0]);
});
test('web release metadata never supplies navigation or executable URLs to the renderer', () => {
  assert.deepEqual(parseWebRelease({version:'1.11.0',releaseURL:'https://attacker.invalid',downloadURL:'file:///evil.exe'}),{version:'1.11.0',releaseURL:PROJECT_LINKS.releases});
  for(const value of [null,{}, {version:'1.11.0-rc.1'}, {version:'<img src=x>'}])assert.throws(()=>parseWebRelease(value));
});
test('renderer update state accepts only bounded display data and drops arbitrary payload fields', () => {
  const value=safeUpdateState({status:'downloading',currentVersion:APP_VERSION,latestVersion:'1.11.0',progress:150,canInstall:true,releaseURL:'https://other.invalid',path:'C:/private',command:'run-this'});
  assert.equal(value.progress,100);assert.equal(value.releaseURL,PROJECT_LINKS.releases);assert.equal(value.canInstall,true);assert(!('path' in value));assert(!('command' in value));
  const bad=safeUpdateState({status:'<script>',currentVersion:'bad',progress:NaN,canInstall:'yes'});assert.equal(bad.status,'error');assert.equal(bad.currentVersion,APP_VERSION);assert.equal(bad.canInstall,false);
});
