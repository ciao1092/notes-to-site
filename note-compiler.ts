import Showdown from "showdown";
import fs, { promises as fsPromises } from "fs";
import * as path from "path";
import {
   parse as parseHTML,
   HTMLElement,
} from "node-html-parser";
import * as YAML from "yaml";

const MardownCompiler = new Showdown.Converter();

const setStaticLinks = (
   dom: HTMLElement,
   staticDirTargetRelativePath: string
) => {
   for (const r of dom.getElementsByTagName(
      "staticCSSref"
   )) {
      const n: string | undefined = r.getAttribute("name");
      if (n === undefined) {
         console.warn(
            `Warning: no name to import ('${r.outerHTML}') (in indexTemplateHTML)`
         );
      } else {
         r.insertAdjacentHTML(
            "beforebegin",
            `<link rel="stylesheet" href="${path.join(
               staticDirTargetRelativePath,
               n
            )}" />`
         );
      }

      r.parentNode.removeChild(r);
   }
};

const checkIFs = (dom: HTMLElement, vars: any) => {
   if (vars === undefined || vars === null) vars = {};

   for (const ifNode of dom.getElementsByTagName(
      "ifTruely"
   )) {
      const varName = ifNode.getAttribute("varName");
      if (varName === undefined) {
         console.warn(
            "condition === undefined, while processing index template"
         );
      } else {
         if (vars[varName]) {
            ifNode.insertAdjacentHTML(
               "beforebegin",
               ifNode.innerHTML
            );
         }
      }
      ifNode.parentNode.removeChild(ifNode);
   }

   for (const ifNode of dom.getElementsByTagName(
      "ifFalsely"
   )) {
      const varName = ifNode.getAttribute("varName");
      if (varName === undefined) {
         console.warn(
            "condition === undefined, while processing index template"
         );
      } else {
         if (!vars[varName]) {
            ifNode.insertAdjacentHTML(
               "beforebegin",
               ifNode.innerHTML
            );
         }
      }
      ifNode.parentNode.removeChild(ifNode);
   }
};

const resolveVars = (dom: HTMLElement, vars: any) => {
   if (vars === undefined || vars === null) vars = {};

   for (const varNode of dom.getElementsByTagName(
      "getVar"
   )) {
      const varName: string | undefined =
         varNode.getAttribute("varName");
      if (varName) {
         const x = vars[varName] || "undefined";
         varNode.insertAdjacentHTML("beforebegin", x);
      } else {
         console.warn("No varname: " + varNode.outerHTML);
      }
      varNode.parentNode.removeChild(varNode);
   }
};

const targetNotDirectory = (outDir): Error =>
   new Error(
      "Cannot proceed: target is not a directory: " + outDir
   );

const copyDirectoryTreeAsync = async (
   sourceDir: string,
   targetDir: string,
   verbose: boolean = true
) => {
   let log = (m) => (verbose ? console.log(m) : undefined);

   if (!fs.existsSync(targetDir))
      await fsPromises.mkdir(targetDir);
   else {
      let s = await fsPromises.stat(targetDir);
      if (!s.isDirectory())
         throw targetNotDirectory(targetDir);
   }

   const dirents = await fsPromises.readdir(sourceDir);
   for (const dirent of dirents) {
      const sourcePath = path.join(sourceDir, dirent);
      const targetPath = path.join(targetDir, dirent);

      if (dirent[0] === ".") {
         log(`Skipping hidden entry "${dirent}"`);
         continue;
      } else {
         log(`Copying ${sourcePath} to ${targetPath}`);
      }

      const stat = await fsPromises.stat(sourcePath);
      if (stat.isDirectory()) {
         await copyDirectoryTreeAsync(
            sourcePath,
            targetPath,
            verbose
         );
      } else {
         await fsPromises.copyFile(sourcePath, targetPath);
      }
   }
};

const processDirectory = async (
   inDir: string,
   outDir: string,
   indexTemplateHTML: string,
   staticDirTargetRelativePath: string,
   isTopDir = true
) => {
   if (!fs.existsSync(outDir))
      await fsPromises.mkdir(outDir);
   else {
      const stat = await fsPromises.stat(outDir);
      if (!stat.isDirectory()) {
         throw targetNotDirectory(outDir);
      } else if (
         (await fsPromises.readdir(outDir)).length > 0
      ) {
         console.warn(
            "Warning: target is not empty: " + outDir
         );
      }
   }

   const indexDOM = parseHTML(indexTemplateHTML);

   checkIFs(indexDOM, { isTopDir: isTopDir });
   resolveVars(indexDOM, {
      indexTitle: path.basename(inDir),
   });

   setStaticLinks(indexDOM, staticDirTargetRelativePath);

   const notesUlNode = indexDOM.getElementById("notes")!;
   notesUlNode.innerHTML = "";
   const noteFileNames = await fsPromises.readdir(inDir);
   for (const noteFileName of noteFileNames) {
      const notePath = path.join(inDir, noteFileName);
      const noteBaseName = path.basename(noteFileName);

      const stat = await fsPromises.stat(notePath);

      if (noteBaseName[0] === ".") {
         console.log(
            "Skipping hidden resource: " + noteBaseName
         );
         continue;
      }

      if (stat.isDirectory()) {
         notesUlNode.innerHTML += `<li><a href="${noteBaseName}">${noteBaseName}/</a></li>`;
         const targetDir = path.join(outDir, noteBaseName);
         if (!fs.existsSync(targetDir))
            await fsPromises.mkdir(targetDir);
         await processDirectory(
            notePath,
            targetDir,
            indexTemplateHTML,
            path.join("..", staticDirTargetRelativePath),
            false
         );

         continue;
      } else {
         const ext = path.extname(noteBaseName);

         if (ext !== ".md") {
            console.log(
               "Skipping non-markdown file: " + noteBaseName
            );
            continue;
         }

         const noteName = noteBaseName.slice(
            0,
            noteBaseName.lastIndexOf(ext)
         );
         const compiledFilename = noteName + ".html";
         const compiledPath = path.join(
            outDir,
            compiledFilename
         );
         console.log(`Compiling ${noteFileName} ...`);

         const fileContent: string = (
            await fsPromises.readFile(notePath)
         ).toString();

         var markdownContent: string = "";
         var yamlContent: string | undefined = undefined;

         const yamlOpen = "---\n";
         const yamlClose = "\n---";
         if (fileContent.startsWith(yamlOpen)) {
            markdownContent = fileContent.slice(
               fileContent.indexOf(yamlClose) +
                  yamlClose.length
            );
            yamlContent = fileContent.slice(
               yamlOpen.length,
               fileContent.indexOf(yamlClose)
            );
         } else {
            markdownContent = fileContent;
         }

         const yamlData: any = yamlContent
            ? YAML.parse(yamlContent)
            : undefined;

         const compiledMarkdown =
            MardownCompiler.makeHtml(markdownContent);

         const mdDOM = parseHTML(compiledMarkdown);
         const noteTitle =
            yamlData &&
            yamlData.title &&
            typeof yamlData.title === "string"
               ? yamlData.title
               : mdDOM.querySelector("h1")?.innerText ||
                 noteName[0].toUpperCase() +
                    noteName.slice(1);

         const noteDOM = parseHTML(
            (
               await fsPromises.readFile(
                  "note.template.html"
               )
            ).toString()
         );

         checkIFs(noteDOM, yamlData);
         resolveVars(noteDOM, yamlData);
         setStaticLinks(
            noteDOM,
            staticDirTargetRelativePath
         );

         for (const titleNode of noteDOM.querySelectorAll(
            ".noteTitle"
         )) {
            titleNode.innerHTML = noteTitle;
         }

         for (const contentNode of noteDOM.querySelectorAll(
            ".noteContent"
         )) {
            contentNode.innerHTML = compiledMarkdown;
         }

         await fsPromises.writeFile(
            compiledPath,
            noteDOM.innerHTML
         );

         notesUlNode.innerHTML += `<li><a href="${compiledFilename}">${noteTitle}</a></li>`;
         continue;
      }
   }

   await fsPromises.writeFile(
      path.join(outDir, "index.html"),
      indexDOM.innerHTML
   );
};

(async () => {
   const outDir = path.join(__dirname, "public");
   const inDir = path.join(
      process.env["HOME"] || "/",
      "",
   );
   const staticDirSrc = path.join(__dirname, "static");
   const staticDirTargetRelativePath = path.relative(
      outDir,
      path.join(outDir, "static")
   );

   const indexTemplateHTML: string = (
      await fsPromises.readFile(
         path.join(__dirname, "index.template.html")
      )
   ).toString();

   await processDirectory(
      inDir,
      path.join(outDir),
      indexTemplateHTML,
      staticDirTargetRelativePath
   );

   await copyDirectoryTreeAsync(
      staticDirSrc,
      path.join(path.relative(__dirname, outDir), "static")
   );
})();
