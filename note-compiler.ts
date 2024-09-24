import Showdown from "showdown";
import fs, { promises as fsPromises } from "fs";
import * as path from "path";
import {
   parse as parseHTML,
   HTMLElement,
} from "node-html-parser";
import * as YAML from "yaml";
import * as htmlTemplates from "./html-template-handler";

const MardownCompiler = new Showdown.Converter();

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
   for await (const dirent of dirents) {
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

   const indexDOM = parseHTML(
      await htmlTemplates.makeHTML(indexTemplateHTML, {
         indexTitle: path.basename(inDir),
         isTopDir,
         staticPath: staticDirTargetRelativePath,
      })
   );

   const notesUlNode = indexDOM.getElementById("notes")!;
   notesUlNode.innerHTML = "";
   const noteFileNames = await fsPromises.readdir(inDir);
   for await (const noteFileName of noteFileNames) {
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

         const compiledMarkdown: string =
            MardownCompiler.makeHtml(markdownContent);

         const mdDOM: HTMLElement = parseHTML(
            compiledMarkdown
         );
         const noteTitle: string =
            yamlData &&
            yamlData.title &&
            typeof yamlData.title === "string"
               ? yamlData.title
               : mdDOM.querySelector("h1")?.innerText ||
                 noteName[0].toUpperCase() +
                    noteName.slice(1);

         const noteTemplaetHTML: string = (
            await fsPromises.readFile("note.template.html")
         ).toString();

         const noteDOM: HTMLElement = parseHTML(
            await htmlTemplates.makeHTML(noteTemplaetHTML, {
               ...yamlData,
               staticPath: staticDirTargetRelativePath,
            })
         );

         for await (const titleNode of noteDOM.querySelectorAll(
            ".noteTitle"
         )) {
            titleNode.innerHTML = noteTitle;
         }

         for await (const contentNode of noteDOM.querySelectorAll(
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
   const outDir = path.join(import.meta.dirname, "public");
   const inDir = path.join(
      process.env["HOME"] || "/",
      "Documents"
   );
   const staticDirSrc = path.join(
      import.meta.dirname,
      "static"
   );
   const staticDirTargetRelativePath = path.relative(
      outDir,
      path.join(outDir, "static")
   );

   const indexTemplateHTML: string = (
      await fsPromises.readFile(
         path.join(
            import.meta.dirname,
            "index.template.html"
         )
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
      path.join(
         path.relative(import.meta.dirname, outDir),
         "static"
      )
   );
})();
