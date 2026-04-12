/// <reference lib="webworker" />
{{ADAPTER_IMPORT}}
import { registerAdapterFactory } from 'inferis-ml/worker';

registerAdapterFactory({{ADAPTER_CALL}});
