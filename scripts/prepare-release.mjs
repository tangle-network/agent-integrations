#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const version=process.argv[2]
if(!version||!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('usage: node scripts/prepare-release.mjs <x.y.z>')
const pkg=readFileSync('package.json','utf8')
const current=JSON.parse(pkg).version
if(current===version)throw new Error(`already ${version}`)
writeFileSync('package.json',pkg.replace(/^(\s*"version":\s*)"[^"]+"/m,(_m,p)=>`${p}"${version}"`))
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim()
const tag=git('describe','--tags','--abbrev=0','--match','v*')
const subjects=git('log','--no-merges','--format=%s',`${tag}..HEAD`).split('\n').filter(Boolean)
if(!subjects.length)throw new Error(`no commits since ${tag}`)
const old=readFileSync('CHANGELOG.md','utf8')
writeFileSync('CHANGELOG.md',`# Changelog\n\n## ${version}\n\n${subjects.map(s=>`- ${s}`).join('\n')}\n\n${old.replace(/^# Changelog\s*/,'')}`)
console.log(`Prepared ${version} from ${subjects.length} commits since ${tag}`)
