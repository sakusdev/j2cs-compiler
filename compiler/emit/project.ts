import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '../diagnostics/index.js';
import { ROOT, type compile } from '../index.js';
const project = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>J2cs.Generated</AssemblyName>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Program.cs" />
    <ProjectReference Include="runtime/J2cs.Runtime/J2cs.Runtime.csproj" />
  </ItemGroup>
</Project>
`;
export async function writeProject(result: ReturnType<typeof compile>, out: string): Promise<string> {
  await mkdir(out, { recursive: true });
  if ((await readdir(out)).length) fail('E_OUTPUT_EXISTS', `Output directory is not empty: ${out}`);
  const runtimeSource = path.join(ROOT, 'runtime/J2cs.Runtime'), runtimeTarget = path.join(out, 'runtime/J2cs.Runtime');
  await mkdir(runtimeTarget, { recursive: true });
  for (const name of await readdir(runtimeSource)) {
    if (name.endsWith('.cs') || name.endsWith('.csproj')) await copyFile(path.join(runtimeSource, name), path.join(runtimeTarget, name));
  }
  await writeFile(path.join(out, 'Program.cs'), result.source);
  await writeFile(path.join(out, 'Generated.csproj'), project);
  // No external NuGet dependencies; generation is buildable offline with the .NET 8 targeting packs.
  await writeFile(path.join(out, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>\n');
  const registry = JSON.parse(await readFile(path.join(ROOT, 'compiler/rules/adapters.json'), 'utf8'));
  await writeFile(path.join(out, 'compilation.json'), JSON.stringify({ version: 1, profile: 'node-primitive-v1',
    ruleDbCommit: registry.ruleDbCommit, structuralContracts: result.structuralContracts, decisions: result.trace }, null, 2) + '\n');
  return path.join(out, 'Generated.csproj');
}
