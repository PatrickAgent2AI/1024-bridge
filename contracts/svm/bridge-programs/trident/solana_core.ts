/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/solana_core.json`.
 */
export type SolanaCore = {
  "address": "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth",
  "metadata": {
    "name": "solanaCore",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Solana Core Bridge Program"
  },
  "instructions": [
    {
      "name": "appendVaaChunk",
      "discriminator": [
        182,
        100,
        208,
        62,
        128,
        144,
        82,
        15
      ],
      "accounts": [
        {
          "name": "vaaBuffer",
          "writable": true
        },
        {
          "name": "payer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "chunk",
          "type": "bytes"
        },
        {
          "name": "offset",
          "type": "u32"
        }
      ]
    },
    {
      "name": "initVaaBuffer",
      "discriminator": [
        223,
        28,
        200,
        135,
        105,
        92,
        172,
        228
      ],
      "accounts": [
        {
          "name": "vaaBuffer",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "vaaSize",
          "type": "u32"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "bridge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  66,
                  114,
                  105,
                  100,
                  103,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "guardianSet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  71,
                  117,
                  97,
                  114,
                  100,
                  105,
                  97,
                  110,
                  83,
                  101,
                  116
                ]
              },
              {
                "kind": "const",
                "value": [
                  92,
                  120,
                  48,
                  48,
                  92,
                  120,
                  48,
                  48,
                  92,
                  120,
                  48,
                  48,
                  92,
                  120,
                  48,
                  48
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "guardianSetIndex",
          "type": "u32"
        },
        {
          "name": "guardians",
          "type": {
            "vec": {
              "array": [
                "u8",
                20
              ]
            }
          }
        },
        {
          "name": "messageFee",
          "type": "u64"
        }
      ]
    },
    {
      "name": "markVaaConsumed",
      "discriminator": [
        231,
        57,
        78,
        148,
        218,
        164,
        108,
        103
      ],
      "accounts": [
        {
          "name": "postedVaa",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "postMessage",
      "discriminator": [
        214,
        50,
        100,
        209,
        38,
        34,
        7,
        76
      ],
      "accounts": [
        {
          "name": "bridge",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  66,
                  114,
                  105,
                  100,
                  103,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "message",
          "writable": true,
          "signer": true
        },
        {
          "name": "emitter",
          "docs": [
            "- User wallet (direct call): passed as Signer's AccountInfo",
            "- Program ID (CPI call): passed as program's AccountInfo",
            "- PDA (advanced): passed with invoke_signed",
            "Security: Guardian validates emitter address in whitelist"
          ]
        },
        {
          "name": "sequence",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  83,
                  101,
                  113,
                  117,
                  101,
                  110,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "emitter"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u32"
        },
        {
          "name": "payload",
          "type": "bytes"
        },
        {
          "name": "consistencyLevel",
          "type": "u8"
        }
      ]
    },
    {
      "name": "postVaa",
      "discriminator": [
        8,
        15,
        198,
        170,
        97,
        124,
        250,
        101
      ],
      "accounts": [
        {
          "name": "bridge",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  66,
                  114,
                  105,
                  100,
                  103,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "guardianSet"
        },
        {
          "name": "vaaBuffer",
          "writable": true
        },
        {
          "name": "postedVaa",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  80,
                  111,
                  115,
                  116,
                  101,
                  100,
                  86,
                  65,
                  65
                ]
              },
              {
                "kind": "arg",
                "path": "emitterChain"
              },
              {
                "kind": "arg",
                "path": "emitterAddress"
              },
              {
                "kind": "arg",
                "path": "sequence"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "emitterChain",
          "type": "u16"
        },
        {
          "name": "emitterAddress",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "sequence",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "bridge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  66,
                  114,
                  105,
                  100,
                  103,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "updateGuardianSet",
      "discriminator": [
        125,
        249,
        145,
        128,
        210,
        246,
        51,
        227
      ],
      "accounts": [
        {
          "name": "bridge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  66,
                  114,
                  105,
                  100,
                  103,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "currentGuardianSet",
          "writable": true
        },
        {
          "name": "vaaBuffer",
          "writable": true
        },
        {
          "name": "newGuardianSet",
          "docs": [
            "new_guardian_set and upgrade_vaa are created as Keypair accounts",
            "They need to be passed in and signed by the caller"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "upgradeVaa",
          "writable": true,
          "signer": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "bridge",
      "discriminator": [
        231,
        232,
        31,
        98,
        110,
        3,
        23,
        59
      ]
    },
    {
      "name": "guardianSet",
      "discriminator": [
        120,
        77,
        74,
        98,
        34,
        83,
        96,
        125
      ]
    },
    {
      "name": "postedMessage",
      "discriminator": [
        254,
        161,
        252,
        44,
        158,
        117,
        222,
        247
      ]
    },
    {
      "name": "postedVaa",
      "discriminator": [
        30,
        127,
        25,
        83,
        211,
        157,
        225,
        196
      ]
    },
    {
      "name": "sequence",
      "discriminator": [
        44,
        170,
        231,
        254,
        142,
        42,
        34,
        199
      ]
    },
    {
      "name": "vaaBuffer",
      "discriminator": [
        219,
        93,
        161,
        108,
        149,
        106,
        243,
        25
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidVaa",
      "msg": "Invalid VAA"
    },
    {
      "code": 6001,
      "name": "vaaAlreadyConsumed",
      "msg": "VAA already consumed"
    },
    {
      "code": 6002,
      "name": "insufficientSignatures",
      "msg": "Insufficient signatures (requires 13/19)"
    },
    {
      "code": 6003,
      "name": "invalidGuardianSet",
      "msg": "Invalid guardian set"
    },
    {
      "code": 6004,
      "name": "guardianSetExpired",
      "msg": "Guardian set expired"
    },
    {
      "code": 6005,
      "name": "invalidSignature",
      "msg": "Invalid signature"
    },
    {
      "code": 6006,
      "name": "bridgePaused",
      "msg": "Bridge is paused"
    },
    {
      "code": 6007,
      "name": "insufficientFee",
      "msg": "Insufficient fee"
    },
    {
      "code": 6008,
      "name": "invalidTargetChain",
      "msg": "Invalid target chain"
    },
    {
      "code": 6009,
      "name": "amountTooLarge",
      "msg": "Amount too large"
    }
  ],
  "types": [
    {
      "name": "bridge",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "guardianSetIndex",
            "type": "u32"
          },
          {
            "name": "messageFee",
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "guardianSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "guardians",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  20
                ]
              }
            }
          },
          {
            "name": "creationTime",
            "type": "i64"
          },
          {
            "name": "expirationTime",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "postedMessage",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "consistencyLevel",
            "type": "u8"
          },
          {
            "name": "emitter",
            "type": "pubkey"
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "u32"
          },
          {
            "name": "nonce",
            "type": "u32"
          },
          {
            "name": "payload",
            "type": "bytes"
          }
        ]
      }
    },
    {
      "name": "postedVaa",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaaVersion",
            "type": "u8"
          },
          {
            "name": "guardianSetIndex",
            "type": "u32"
          },
          {
            "name": "timestamp",
            "type": "u32"
          },
          {
            "name": "nonce",
            "type": "u32"
          },
          {
            "name": "emitterChain",
            "type": "u16"
          },
          {
            "name": "emitterAddress",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sequence",
            "type": "u64"
          },
          {
            "name": "consistencyLevel",
            "type": "u8"
          },
          {
            "name": "payload",
            "type": "bytes"
          },
          {
            "name": "consumed",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "sequence",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sequence",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaaBuffer",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalSize",
            "type": "u32"
          },
          {
            "name": "writtenSize",
            "type": "u32"
          },
          {
            "name": "data",
            "type": "bytes"
          },
          {
            "name": "finalized",
            "type": "bool"
          }
        ]
      }
    }
  ]
};
