import { describeProspectStore } from "./store-contract.test-support.ts";
import { createInMemoryProspectStore } from "./store.ts";

describeProspectStore("createInMemoryProspectStore", (dependencies) =>
  Promise.resolve(createInMemoryProspectStore(dependencies)),
);
