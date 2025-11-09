/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/token_bridge.json`.
 */
export type TokenBridge = {
  "address": "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb",
  "metadata": {
    "name": "tokenBridge",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Token Bridge Program"
  },
  "instructions": [
    {
      "name": "completeTransfer",
      "discriminator": [
        98,
        39,
        123,
        229,
        202,
        12,
        82,
        182
      ],
      "accounts": [
        {
          "name": "bridge"
        },
        {
          "name": "postedVaa",
          "writable": true
        },
        {
          "name": "tokenBinding"
        },
        {
          "name": "recipientAccount",
          "writable": true
        },
        {
          "name": "custodyAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  67,
                  117,
                  115,
                  116,
                  111,
                  100,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "targetTokenMint"
              }
            ]
          }
        },
        {
          "name": "targetTokenMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
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
          "name": "bridgeConfig",
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
                  101,
                  67,
                  111,
                  110,
                  102,
                  105,
                  103
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
          "name": "authority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initializeCustody",
      "discriminator": [
        229,
        218,
        228,
        120,
        208,
        239,
        223,
        234
      ],
      "accounts": [
        {
          "name": "custody",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  67,
                  117,
                  115,
                  116,
                  111,
                  100,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "registerBidirectionalBinding",
      "discriminator": [
        79,
        174,
        155,
        126,
        208,
        103,
        30,
        239
      ],
      "accounts": [
        {
          "name": "bridgeConfig",
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
                  101,
                  67,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "outboundBinding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  84,
                  111,
                  107,
                  101,
                  110,
                  66,
                  105,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "localChain"
              },
              {
                "kind": "arg",
                "path": "localToken"
              },
              {
                "kind": "arg",
                "path": "remoteChain"
              },
              {
                "kind": "arg",
                "path": "remoteToken"
              }
            ]
          }
        },
        {
          "name": "inboundBinding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  84,
                  111,
                  107,
                  101,
                  110,
                  66,
                  105,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "remoteChain"
              },
              {
                "kind": "arg",
                "path": "remoteToken"
              },
              {
                "kind": "arg",
                "path": "localChain"
              },
              {
                "kind": "arg",
                "path": "localToken"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "bridgeConfig"
          ]
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
          "name": "localChain",
          "type": "u16"
        },
        {
          "name": "localToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "remoteChain",
          "type": "u16"
        },
        {
          "name": "remoteToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "outboundRateNum",
          "type": "u64"
        },
        {
          "name": "outboundRateDenom",
          "type": "u64"
        },
        {
          "name": "inboundRateNum",
          "type": "u64"
        },
        {
          "name": "inboundRateDenom",
          "type": "u64"
        }
      ]
    },
    {
      "name": "registerTokenBinding",
      "discriminator": [
        186,
        56,
        245,
        215,
        22,
        159,
        110,
        255
      ],
      "accounts": [
        {
          "name": "bridgeConfig",
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
                  101,
                  67,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenBinding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  84,
                  111,
                  107,
                  101,
                  110,
                  66,
                  105,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "sourceChain"
              },
              {
                "kind": "arg",
                "path": "sourceToken"
              },
              {
                "kind": "arg",
                "path": "targetChain"
              },
              {
                "kind": "arg",
                "path": "targetToken"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "bridgeConfig"
          ]
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
          "name": "sourceChain",
          "type": "u16"
        },
        {
          "name": "sourceToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "targetChain",
          "type": "u16"
        },
        {
          "name": "targetToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "setExchangeRate",
      "discriminator": [
        174,
        65,
        205,
        238,
        110,
        112,
        152,
        178
      ],
      "accounts": [
        {
          "name": "bridgeConfig",
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
                  101,
                  67,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenBinding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  84,
                  111,
                  107,
                  101,
                  110,
                  66,
                  105,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "sourceChain"
              },
              {
                "kind": "arg",
                "path": "sourceToken"
              },
              {
                "kind": "arg",
                "path": "targetChain"
              },
              {
                "kind": "arg",
                "path": "targetToken"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "bridgeConfig"
          ]
        }
      ],
      "args": [
        {
          "name": "sourceChain",
          "type": "u16"
        },
        {
          "name": "sourceToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "targetChain",
          "type": "u16"
        },
        {
          "name": "targetToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "rateNumerator",
          "type": "u64"
        },
        {
          "name": "rateDenominator",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setTokenBindingEnabled",
      "discriminator": [
        124,
        84,
        45,
        11,
        16,
        209,
        21,
        191
      ],
      "accounts": [
        {
          "name": "bridgeConfig",
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
                  101,
                  67,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenBinding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  84,
                  111,
                  107,
                  101,
                  110,
                  66,
                  105,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "sourceChain"
              },
              {
                "kind": "arg",
                "path": "sourceToken"
              },
              {
                "kind": "arg",
                "path": "targetChain"
              },
              {
                "kind": "arg",
                "path": "targetToken"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "bridgeConfig"
          ]
        }
      ],
      "args": [
        {
          "name": "sourceChain",
          "type": "u16"
        },
        {
          "name": "sourceToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "targetChain",
          "type": "u16"
        },
        {
          "name": "targetToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "enabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "transferTokens",
      "discriminator": [
        54,
        180,
        238,
        175,
        74,
        85,
        126,
        188
      ],
      "accounts": [
        {
          "name": "coreProgram",
          "address": "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
        },
        {
          "name": "bridge"
        },
        {
          "name": "tokenBinding",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  84,
                  111,
                  107,
                  101,
                  110,
                  66,
                  105,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "const",
                "value": [
                  132,
                  3
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              },
              {
                "kind": "arg",
                "path": "targetChain"
              },
              {
                "kind": "arg",
                "path": "targetToken"
              }
            ]
          }
        },
        {
          "name": "tokenAccount",
          "writable": true
        },
        {
          "name": "custodyAccount",
          "writable": true
        },
        {
          "name": "tokenAuthority",
          "signer": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "message",
          "writable": true,
          "signer": true
        },
        {
          "name": "emitter",
          "address": "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb"
        },
        {
          "name": "sequence",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "targetChain",
          "type": "u16"
        },
        {
          "name": "targetToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "recipient",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "updateAmmConfig",
      "discriminator": [
        49,
        60,
        174,
        136,
        154,
        28,
        116,
        200
      ],
      "accounts": [
        {
          "name": "bridgeConfig",
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
                  101,
                  67,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenBinding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  84,
                  111,
                  107,
                  101,
                  110,
                  66,
                  105,
                  110,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "arg",
                "path": "sourceChain"
              },
              {
                "kind": "arg",
                "path": "sourceToken"
              },
              {
                "kind": "arg",
                "path": "targetChain"
              },
              {
                "kind": "arg",
                "path": "targetToken"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "bridgeConfig"
          ]
        }
      ],
      "args": [
        {
          "name": "sourceChain",
          "type": "u16"
        },
        {
          "name": "sourceToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "targetChain",
          "type": "u16"
        },
        {
          "name": "targetToken",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "ammProgramId",
          "type": "pubkey"
        },
        {
          "name": "useExternalPrice",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bridgeConfig",
      "discriminator": [
        40,
        206,
        51,
        233,
        246,
        40,
        178,
        85
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
      "name": "tokenBinding",
      "discriminator": [
        95,
        81,
        92,
        58,
        10,
        176,
        12,
        230
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidTokenAccount",
      "msg": "Invalid token account"
    },
    {
      "code": 6001,
      "name": "insufficientBalance",
      "msg": "Insufficient balance"
    },
    {
      "code": 6002,
      "name": "invalidPayload",
      "msg": "Invalid payload"
    },
    {
      "code": 6003,
      "name": "tokenBindingNotFound",
      "msg": "Token binding not found"
    },
    {
      "code": 6004,
      "name": "tokenBindingExists",
      "msg": "Token binding already exists"
    },
    {
      "code": 6005,
      "name": "tokenBindingNotEnabled",
      "msg": "Token binding not enabled"
    },
    {
      "code": 6006,
      "name": "invalidExchangeRate",
      "msg": "Invalid exchange rate"
    },
    {
      "code": 6007,
      "name": "zeroDenominator",
      "msg": "Exchange rate denominator cannot be zero"
    },
    {
      "code": 6008,
      "name": "targetTokenMismatch",
      "msg": "Target token mismatch"
    },
    {
      "code": 6009,
      "name": "exchangeDisabled",
      "msg": "Exchange feature disabled"
    },
    {
      "code": 6010,
      "name": "unauthorized",
      "msg": "Unauthorized: not bridge authority"
    },
    {
      "code": 6011,
      "name": "ammPriceFetchFailed",
      "msg": "AMM price fetch failed"
    },
    {
      "code": 6012,
      "name": "slippageExceeded",
      "msg": "Slippage exceeded"
    },
    {
      "code": 6013,
      "name": "vaaAlreadyConsumed",
      "msg": "VAA already consumed"
    },
    {
      "code": 6014,
      "name": "invalidTargetChain",
      "msg": "Invalid target chain"
    }
  ],
  "types": [
    {
      "name": "bridgeConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "exchangeEnabled",
            "type": "bool"
          },
          {
            "name": "defaultFeeBps",
            "type": "u16"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
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
      "name": "tokenBinding",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sourceChain",
            "type": "u16"
          },
          {
            "name": "sourceToken",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "targetChain",
            "type": "u16"
          },
          {
            "name": "targetToken",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rateNumerator",
            "type": "u64"
          },
          {
            "name": "rateDenominator",
            "type": "u64"
          },
          {
            "name": "useExternalPrice",
            "type": "bool"
          },
          {
            "name": "ammProgramId",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          }
        ]
      }
    }
  ]
};
