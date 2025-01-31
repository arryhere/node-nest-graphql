# App

##### Stack

- node
- nest
- graphql
- postgres
- prisma

##### Initial Setup

- npm i
- docker compose -f ./compose.db.yaml --env-file ./.env up --build -d
- npx prisma migrate deploy
- npm run seed
- npm run start:dev

- dev: docker compose -f ./compose.dev.yaml --env-file ./.env.dev up --build -d

# Nest

##### Nest useful commands

- nest g module <module_name>
- nest g resource <resource_name>
- nest g controller <controller_name>
- nest g service <service_name>

---

# Prisma

##### Prisma useful commands

- npx prisma generate
- npx prisma migrate dev --name <migration_name>
- npx prisma migrate deploy
- npx prisma db push
- npx prisma studio

---

# Build & Bundling

### SWC

##### Dependencies

- @swc/cli
- @swc/core

##### Info

- Building with swc only transpiles .ts to .js, it does not buldle your code.
- If you are olny using swc to transpile then you need node_moduels to run you build file.

### NCC

##### Dependencies

- @vercel/ncc

##### Info

- If you are using ncc, then it transpiles and then buldles your code (using webpack).
- So you don't need node_modules to run your build file.
- A single index.js file is created, that contains all your code, just run that.
- In this project some prisma dependencies (\*.node) which cannot be bundled, is also required to run the build file, so make sure to copy those as well.

### Prisma

- build > bundling > ./node_modules/.prisma/client/<os_specific_node_files>
- After building and bundling you code, you need to have the .node files which are platform independent files which prisma requires to run.
- Copy those files and put it in the root directory where you root.js file is generated, in this case the file is index.js.

---

# Packaging

##### Dependencies

- pkg

##### Info

- Using pkg, we are targeting the following architectures and os ->
  macos-arm64
  macos-x64
  win-x64
  linux-x64
  linux-arm64"

- Note current prisma binaryTargets does not support windows arm64, so we are not packaging for windows on arm

---

# Nest - usefull links

- https://stackoverflow.com/questions/74548546/what-is-the-difference-between-inputtype-and-objecttype-in-nestjs

---

# Dependency Update

- npm outdated
- npm i <_dependency_>@latest

---
