import type { Graph } from "graphlib";
import * as graphlib from "graphlib";
import { parseTypedLink } from "juggl-api";
import {
  App,
  FrontMatterCache,
  Notice,
  Pos,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { dropHeaderOrAlias, splitLinksRegex } from "src/constants";
import type {
  BreadcrumbsSettings,
  dvFrontmatterCache,
  dvLink,
  JugglLink,
  neighbourObj,
  relObj,
} from "src/interfaces";
import type BreadcrumbsPlugin from "src/main";
import type MatrixView from "src/MatrixView";

export function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b);
}

export function normalise(arr: number[]): number[] {
  const max = Math.max(...arr);
  return arr.map((item) => item / max);
}

export const isSubset = <T>(arr1: T[], arr2: T[]): boolean =>
  arr1.every((value) => arr2.includes(value));

export function debug(settings: BreadcrumbsSettings, log: any): void {
  if (settings.debugMode) {
    console.log(log);
  }
}

export function superDebug(settings: BreadcrumbsSettings, log: any): void {
  if (settings.superDebugMode) {
    console.log(log);
  }
}

export function getDVMetadataCache(
  app: App,
  settings: BreadcrumbsSettings,
  files: TFile[]
) {
  debug(settings, "Using Dataview");

  const fileFrontmatterArr: dvFrontmatterCache[] = [];
  files.forEach((file) => {
    superDebug(settings, `GetDVMetadataCache: ${file.basename}`);

    const dvCache: dvFrontmatterCache = app.plugins.plugins.dataview.api.page(
      file.path
    );

    superDebug(settings, { dvCache });
    fileFrontmatterArr.push(dvCache);
  });

  debug(settings, { fileFrontmatterArr });
  return fileFrontmatterArr;
}

export function getObsMetadataCache(
  app: App,
  settings: BreadcrumbsSettings,
  files: TFile[]
) {
  debug(settings, "Using Obsidian");

  const fileFrontmatterArr: dvFrontmatterCache[] = [];

  files.forEach((file) => {
    superDebug(settings, `GetObsMetadataCache: ${file.basename}`);
    const obs: FrontMatterCache =
      app.metadataCache.getFileCache(file)?.frontmatter;
    superDebug(settings, { obs });
    if (obs) {
      fileFrontmatterArr.push({ file, ...obs });
    } else {
      fileFrontmatterArr.push({ file });
    }
  });

  debug(settings, { fileFrontmatterArr });
  return fileFrontmatterArr;
}

export function splitAndDrop(str: string): string[] | [] {
  return (
    str
      ?.match(splitLinksRegex)
      ?.map((link) => link.match(dropHeaderOrAlias)?.[1]) ?? []
  );
}

// TODO I think it'd be better to do this whole thing as an obj instead of JugglLink[]
// => {[note: string]: {type: string, linksInLine: string[]}[]}
export async function getJugglLinks(
  app: App,
  settings: BreadcrumbsSettings
): Promise<JugglLink[]> {
  const files = app.vault.getMarkdownFiles();
  // Add Juggl links
  const typedLinksArr: JugglLink[] = await Promise.all(
    files.map(async (file) => {
      const jugglLink: JugglLink = { note: file.basename, links: [] };

      // Use Obs metadatacache to get the links in the current file
      const links = app.metadataCache.getFileCache(file)?.links ?? [];
      const content = await app.vault.cachedRead(file);

      links.forEach((link) => {
        // Get the line no. of each link
        const lineNo = link.position.start.line;
        // And the corresponding line content
        const line = content.split("\n")[lineNo];

        // Get an array of inner text of each link
        const linksInLine =
          line
            .match(splitLinksRegex)
            ?.map((link) => link.slice(2, link.length - 2))
            ?.map((innerText) => innerText.split("|")[0]) ?? [];

        const parsedLinks = parseTypedLink(link, line, "-");
        jugglLink.links.push({
          type: parsedLinks?.properties?.type ?? "",
          linksInLine,
        });
      });
      return jugglLink;
    })
  );

  debug(settings, { typedLinksArr });

  const allFields: string[] = settings.userHierarchies
    .map((hier) => Object.values(hier))
    .flat()
    .filter((field: string) => field !== "");

  typedLinksArr.forEach((jugglLink) => {
    if (jugglLink.links.length) {
      // Filter out links whose type is not in allFields
      // TODO This could probably be done better with filter?
      const fieldTypesOnly = [];
      jugglLink.links.forEach((link) => {
        if (allFields.includes(link.type)) {
          fieldTypesOnly.push(link);
        }
      });
      // I don't remember why I'm mutating the links instead of making a new obj
      jugglLink.links = fieldTypesOnly;
    }
  });

  // Filter out the juggl links with no links
  const filteredLinks = typedLinksArr.filter((link) => !!link.links.length);
  debug(settings, { filteredLinks });
  return filteredLinks;
}

export function getFieldValues(
  frontmatterCache: dvFrontmatterCache,
  field: string,
  settings: BreadcrumbsSettings
) {
  const values: string[] = [];
  try {
    const rawValues: (string | dvLink | Pos | TFile | undefined)[] = [
      frontmatterCache?.[field],
    ].flat(5);

    superDebug(settings, `${field} of: ${frontmatterCache?.file?.path}`);
    superDebug(settings, { rawValues });

    rawValues.forEach((rawItem) => {
      if (!rawItem) return;
      if (typeof rawItem === "string") {
        const splits = rawItem.match(splitLinksRegex);
        if (splits !== null) {
          const strs = splits
            .map((link) => link.match(dropHeaderOrAlias)[1])
            .map((str: string) => str.split("/").last());
        } else {
          values.push(rawItem.split("/").last());
        }
      } else if (rawItem.path) {
        values.push((rawItem as dvLink).path.split("/").last());
      }
    });
    return values;
  } catch (error) {
    return values;
  }
}

export const splitAndTrim = (fields: string): string[] =>
  fields.split(",").map((str: string) => str.trim());

export async function getNeighbourObjArr(
  plugin: BreadcrumbsPlugin,
  fileFrontmatterArr: dvFrontmatterCache[]
): Promise<
  {
    current: TFile;
    hierarchies: { [field: string]: string[] }[];
  }[]
> {
  const { userHierarchies } = plugin.settings;
  const allFields: string[] = userHierarchies
    .map((hier) => Object.values(hier))
    .flat()
    .filter((field: string) => field !== "");

  let jugglLinks: JugglLink[] = [];
  if (plugin.app.plugins.plugins.juggl !== undefined) {
    jugglLinks = await getJugglLinks(plugin.app, plugin.settings);
  }

  const neighbourObjArr: {
    current: TFile;
    hierarchies: { [field: string]: string[] }[];
  }[] = fileFrontmatterArr.map((fileFrontmatter) => {
    const hierFields: {
      current: TFile;
      hierarchies: { [field: string]: string[] }[];
    } = {
      current: fileFrontmatter.file,
      hierarchies: [],
    };

    userHierarchies.forEach((hier, i) => {
      const fields: string[] = Object.values(hier);
      const newHier: { [field: string]: string[] } = {};
      fields.forEach((field) => {
        const fieldValues = getFieldValues(
          fileFrontmatter,
          field,
          plugin.settings
        );
        newHier[field] = fieldValues;
      });
      hierFields.hierarchies.push(newHier);
    });

    return hierFields;
  });

  console.log({ neighbourObjArr });
  debug(plugin.settings, { neighbourObjArr });
  return neighbourObjArr;
}

// This function takes the real & implied graphs for a given relation, and returns a new graphs with both.
// It makes implied relations real
export function closeImpliedLinks(real: Graph, implied: Graph): Graph {
  console.log({ real, implied });
  const closedG = graphlib.json.read(graphlib.json.write(real));
  implied.edges().forEach((impliedEdge) => {
    closedG.setEdge(impliedEdge.w, impliedEdge.v);
  });
  return closedG;
}

export const isInVault = (app: App, note: string): boolean =>
  !!app.metadataCache.getFirstLinkpathDest(
    note,
    app.workspace.getActiveFile().path
  );

export function hoverPreview(event: MouseEvent, matrixView: MatrixView): void {
  const targetEl = event.target as HTMLElement;

  matrixView.app.workspace.trigger("hover-link", {
    event,
    source: matrixView.getViewType(),
    hoverParent: matrixView,
    targetEl,
    linktext: targetEl.innerText,
  });
}

export async function openOrSwitch(
  app: App,
  dest: string,
  currFile: TFile,
  event: MouseEvent
): Promise<void> {
  const { workspace } = app;
  const destFile = app.metadataCache.getFirstLinkpathDest(dest, currFile.path);

  const openLeaves: WorkspaceLeaf[] = [];
  // For all open leaves, if the leave's basename is equal to the link destination, rather activate that leaf instead of opening it in two panes
  workspace.iterateAllLeaves((leaf) => {
    if (leaf.view?.file?.basename === dest) {
      openLeaves.push(leaf);
    }
  });

  if (openLeaves.length > 0) {
    workspace.setActiveLeaf(openLeaves[0]);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mode = (app.vault as any).getConfig("defaultViewMode");
    const leaf = event.ctrlKey
      ? workspace.splitActiveLeaf()
      : workspace.getUnpinnedLeaf();
    await leaf.openFile(destFile, { active: true, mode });
  }
}

export function padArray(arr: any[], finalLength: number, filler = ""): any[] {
  const copy = [...arr];
  const currLength = copy.length;
  if (currLength > finalLength) {
    throw new Error("Current length is greater than final length");
  } else if (currLength === finalLength) {
    return copy;
  } else {
    for (let i = currLength; i < finalLength; i++) {
      copy.push(filler);
    }
    return copy;
  }
}

export function transpose(A: any[][]): any[][] {
  const cols = A[0].length;
  const AT: any[][] = [];
  // For each column
  for (let j = 0; j < cols; j++) {
    // Add a new row to AT
    AT.push([]);
    // And fill it with the values in the jth column of A
    A.forEach((row) => AT[j].push(row[j]));
  }
  return AT;
}

export function runs(
  arr: string[]
): { value: string; first: number; last: number }[] {
  const runs: { value: string; first: number; last: number }[] = [];
  let i = 0;
  while (i < arr.length) {
    const currValue = arr[i];
    runs.push({ value: currValue, first: i, last: undefined });
    while (currValue === arr[i]) {
      i++;
    }
    runs.last().last = i - 1;
  }
  return runs;
}

// SOURCE https://stackoverflow.com/questions/9960908/permutations-in-javascript
export function permute(permutation: any[]): any[][] {
  const length = permutation.length,
    result = [permutation.slice()],
    c = new Array(length).fill(0);

  let i = 1,
    k: number,
    p: number;

  while (i < length) {
    if (c[i] < i) {
      k = i % 2 && c[i];
      p = permutation[i];
      permutation[i] = permutation[k];
      permutation[k] = p;
      ++c[i];
      i = 1;
      result.push(permutation.slice());
    } else {
      c[i] = 0;
      ++i;
    }
  }
  return result;
}

export function dropMD(path: string) {
  return path.split(".md", 1)[0];
}

export const range = (n: number) => [...Array(5).keys()];

export function complement<T>(A: T[], B: T[]) {
  return A.filter((a) => !B.includes(a));
}

export async function copy(content: string) {
  await navigator.clipboard.writeText(content).then(
    () => new Notice("Copied to clipboard"),
    () => new Notice("Could not copy to clipboard")
  );
}

export function makeWiki(wikiQ: boolean, str: string) {
  let copy = str.slice();
  if (wikiQ) {
    copy = "[[" + copy;
    copy += "]]";
  }
  return copy;
}

export function mergeGraphs(g1: Graph, g2: Graph) {
  const copy1 = graphlib.json.read(graphlib.json.write(g1));
  g2.edges().forEach((edge) => {
    copy1.setEdge(edge.v, edge.w);
  });
  return copy1;
}

export function mergeGs(...graphs: Graph[]) {
  const copy = graphlib.json.read(graphlib.json.write(graphs[0]));
  graphs.forEach((graph, i) => {
    if (i > 0) {
      graph.edges().forEach((edge) => {
        copy.setEdge(edge);
      });
    }
  });
  return copy;
}

export function removeUnlinkedNodes(g: Graph) {
  const copy = graphlib.json.read(graphlib.json.write(g));
  const nodes = copy.nodes();
  const unlinkedNodes = nodes.filter(
    (node) => !(copy.neighbors(node) as string[]).length
  );
  unlinkedNodes.forEach((node) => copy.removeNode(node));
  return copy;
}

export function getAllXGs(
  plugin: BreadcrumbsPlugin,
  rel: "up" | "same" | "down"
) {
  const { userHierarchies } = plugin.settings;
  const fieldNamesInXDir = userHierarchies
    .map((hier) => hier[rel])
    .filter((field) => field !== "");
  const currHiers = plugin.currGraphs;
  const allXGs: { [rel: string]: Graph } = {};
  currHiers.forEach((hier) => {
    fieldNamesInXDir.forEach((field) => {
      const graph = hier[field];
      if (hier[field]) {
        allXGs[field] = graph;
      }
    });
  });
  return allXGs;
}
