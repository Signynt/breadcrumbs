// import { MultiGraph } from "graphology";
// import { getReflexiveClosure } from "src/sharedFunctions";

require("approvals").mocha();

describe("When running some tests", function () {
  it("should be able to use Approvals", function () {
    const data = "test";
    // const userHiers = [
    //   {
    //     down: ["down"],
    //     next: ["next"],
    //     prev: ["prev"],
    //     same: ["same"],
    //     up: ["up"],
    //   },
    // ];

    // const g = new MultiGraph();
    // g.addNode("A");
    // g.addNode("B");
    // g.addNode("C");

    // g.addEdge("A", "B", { dir: "up", field: "parent" });
    // g.addEdge("C", "A", { dir: "prev", field: "previous" });

    // getReflexiveClosure(g, userHiers);

    this.verify(data); // or this.verifyAsJSON(data)
  });
});

export {};