use contracts::{Input, WorldSetup};
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;

fn error(message: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&message.to_string()).into()
}

fn decode<T: DeserializeOwned>(value: JsValue) -> Result<T, JsValue> {
    let text = js_sys::JSON::stringify(&value)
        .map_err(|e| error(format!("{e:?}")))?
        .as_string()
        .ok_or_else(|| error("expected JSON data"))?;
    serde_json::from_str(&text).map_err(error)
}

#[wasm_bindgen]
pub struct World {
    inner: physics::World,
}

#[wasm_bindgen]
impl World {
    #[wasm_bindgen(constructor)]
    pub fn new(setup: JsValue) -> Result<World, JsValue> {
        let setup: WorldSetup = decode(setup)?;
        Ok(Self {
            inner: physics::World::new(setup).map_err(error)?,
        })
    }

    pub fn step(&mut self, inputs: JsValue) -> Result<(), JsValue> {
        let inputs: Vec<Input> = decode(inputs)?;
        self.inner.step(&inputs).map_err(error)
    }

    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        let text = serde_json::to_string(&self.inner.snapshot()).map_err(error)?;
        js_sys::JSON::parse(&text).map_err(|e| error(format!("{e:?}")))
    }

    #[wasm_bindgen(js_name = stateHash)]
    pub fn state_hash(&self) -> Result<String, JsValue> {
        self.inner.state_hash().map_err(error)
    }

    pub fn save(&self) -> Result<Vec<u8>, JsValue> {
        self.inner.save().map_err(error)
    }

    pub fn load(bytes: &[u8]) -> Result<World, JsValue> {
        Ok(Self {
            inner: physics::World::load(bytes).map_err(error)?,
        })
    }
}
