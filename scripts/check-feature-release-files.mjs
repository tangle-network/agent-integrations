#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const base=`origin/${process.env.GITHUB_BASE_REF||'main'}`
const baseVersion=JSON.parse(execFileSync('git',['show',`${base}:package.json`],{encoding:'utf8'})).version
const headVersion=JSON.parse(readFileSync('package.json','utf8')).version
const changed=execFileSync('git',['diff','--name-only',`${base}...HEAD`],{encoding:'utf8'}).trim().split('\n').filter(Boolean)
if(baseVersion!==headVersion||changed.includes('CHANGELOG.md'))throw new Error('feature PRs must not change package version or CHANGELOG.md; run Prepare Release after merge')
console.log(`release files clean at ${headVersion}`)
