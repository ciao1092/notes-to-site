import * as htmlParser from "node-html-parser";

const scopedEval = async (
   code: string,
   context: Record<string, any>
) => {
   const checkVar = (varName: string): boolean =>
      varName in Object.keys(global);

   console.log(Object.keys(window));

   context = {
      ...context,
      check: checkVar,
      path: await import("path"),
   };

   try {
      return new Function(
         ...Object.keys(context),
         `return ${code};`
      )(...Object.values(context));
   } catch (e) {
      console.error("Failed evaluating code");
      console.log("Context:", context);
      throw e;
   }
};

export async function makeHTML(
   HTMLTemplateSource: string,
   vars?: Record<string, any>
): Promise<string> {
   if (!vars) vars = {};
   const dom = htmlParser.parse(HTMLTemplateSource);
   const DOMElements = dom.querySelectorAll("*");

   /**
    * Process conditionatsls
    */
   for (const ifNode of dom.getElementsByTagName("x-if")) {
      const condition: string | undefined =
         ifNode.getAttribute("condition");
      if (condition) {
         if (await scopedEval(condition, vars)) {
            ifNode.insertAdjacentHTML(
               "beforebegin",
               ifNode.innerHTML
            );
         }
      }
      ifNode.parentNode.removeChild(ifNode);
   }

   /**
    * Process XAttributes ("element[x-.*]")
    */
   for await (const element of DOMElements) {
      const xAttributes = Object.keys(
         element.attributes
      ).filter((a) => a.startsWith("x-"));
      for await (const xAttribute of xAttributes) {
         const baseAttributeName = xAttribute.slice(
            "x-".length
         );

         const attributeStatement =
            element.getAttribute(xAttribute)!;

         element.setAttribute(
            baseAttributeName,
            await scopedEval(attributeStatement, vars)
         );

         element.removeAttribute(xAttribute);
      }
   }

   /**
    * Resolve variables
    */
   for (const varNode of dom.getElementsByTagName(
      "x-var"
   )) {
      const varName: string | undefined =
         varNode.getAttribute("name");
      if (varName) {
         const varValue = await scopedEval(varName, vars);
         varNode.insertAdjacentHTML(
            "beforebegin",
            varValue === undefined || varValue === null
               ? "undefined"
               : varValue
         );
      }
      varNode.parentNode.removeChild(varNode);
   }

   return dom.innerHTML;
}
