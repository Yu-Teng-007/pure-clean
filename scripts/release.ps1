# 净界 · 一键发布
# 用法: .\scripts\release.ps1 [patch|minor|major|x.y.z] [-y] [-DryRun]
param(
    [string]$Version = "patch",
    [switch]$Yes,
    [switch]$DryRun,
    [string]$Remote = "github",
    [switch]$SkipPush,
    [switch]$Watch,
    [switch]$Publish
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$argsList = @($Version)
if ($Yes) { $argsList += "-y" }
if ($DryRun) { $argsList += "--dry-run" }
if ($Remote -ne "github") { $argsList += @("--remote", $Remote) }
if ($SkipPush) { $argsList += "--skip-push" }
if ($Watch) { $argsList += "--watch" }
if ($Publish) { $argsList += "--publish" }

npm run release -- @argsList
